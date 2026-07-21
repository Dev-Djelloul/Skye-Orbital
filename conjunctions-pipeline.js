// Orchestration Cloudflare (KV/D1/Queue) du screening de conjonctions.
// Toute la logique orbitale/algorithmique vit dans conjunctions.js (pure,
// testable en Node) — ce fichier ne fait que la plomberie entre étapes.
import * as satellite from 'satellite.js';
import * as Conj from './conjunctions.js';

// conjunctions.js dépend du global `satellite` (même convention que le
// frontend, où satellite.js est chargé via <script> — ici on l'expose
// nous-mêmes puisqu'un Worker n'a pas d'équivalent).
globalThis.satellite = satellite;

const GROUPS_FOR_SCREENING = [
  'stations',
  'starlink',
  'cosmos-1408-debris',
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
];

function todayRunId() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowIso() {
  return new Date().toISOString();
}

// --- Étape 1 : kickoff (cron quotidien) ------------------------------------

export async function kickoff(env, getCachedOrFetchTle) {
  const runId = todayRunId();

  const existing = await env.DB.prepare('SELECT run_id FROM conjunction_runs WHERE run_id = ?')
    .bind(runId)
    .first();
  if (existing) return { skipped: true, runId };

  const groupResults = await Promise.all(GROUPS_FOR_SCREENING.map((g) => getCachedOrFetchTle(env, g)));

  const rawObjects = [];
  GROUPS_FOR_SCREENING.forEach((group, i) => {
    for (const obj of groupResults[i].objects) rawObjects.push({ ...obj, group });
  });

  await env.CONJ_KV.put(`conj:${runId}:raw`, JSON.stringify(rawObjects));

  const parseChunks = Conj.chunkArray(rawObjects, Conj.PARSE_CHUNK_SIZE);

  await env.DB.prepare(
    `INSERT INTO conjunction_runs (run_id, stage, parse_total, started_at, updated_at)
     VALUES (?, 'parsing', ?, ?, ?)`
  )
    .bind(runId, parseChunks.length, nowIso(), nowIso())
    .run();

  for (let i = 0; i < parseChunks.length; i++) {
    const startIdx = i * Conj.PARSE_CHUNK_SIZE;
    await env.CONJ_QUEUE.send({
      type: 'parse-chunk',
      runId,
      startIdx,
      endIdx: Math.min(startIdx + Conj.PARSE_CHUNK_SIZE, rawObjects.length),
    });
  }

  return { runId, totalObjects: rawObjects.length, parseChunks: parseChunks.length };
}

// --- Étape 2 : parse-chunk --------------------------------------------------

export async function parseChunk(env, message) {
  const { runId, startIdx, endIdx } = message;
  const raw = JSON.parse(await env.CONJ_KV.get(`conj:${runId}:raw`));
  const slice = raw.slice(startIdx, endIdx);
  const records = slice.map((o) => Conj.buildRecord(o, o.group)).filter(Boolean);

  await env.CONJ_KV.put(`conj:${runId}:records:${startIdx}`, JSON.stringify(records));

  const result = await env.DB.prepare(
    `UPDATE conjunction_runs SET parse_done = parse_done + 1, updated_at = ?
     WHERE run_id = ? RETURNING parse_done, parse_total`
  )
    .bind(nowIso(), runId)
    .first();

  if (result.parse_done === result.parse_total) {
    await env.CONJ_QUEUE.send({ type: 'bin-and-dispatch', runId });
  }
}

// --- Étape 3 : bin-and-dispatch (message unique) ---------------------------

export async function binAndDispatch(env, message) {
  const { runId } = message;
  const raw = JSON.parse(await env.CONJ_KV.get(`conj:${runId}:raw`));
  const parseChunks = Conj.chunkArray(raw, Conj.PARSE_CHUNK_SIZE);

  let records = [];
  for (let i = 0; i < parseChunks.length; i++) {
    const startIdx = i * Conj.PARSE_CHUNK_SIZE;
    const chunkRecords = JSON.parse(await env.CONJ_KV.get(`conj:${runId}:records:${startIdx}`));
    records = records.concat(chunkRecords);
  }

  const bins = Conj.buildBins(records);
  const pairs = Conj.collectCandidatePairs(bins);
  const uniqueIds = [...Conj.collectUniqueNoradIds(pairs)];

  await env.CONJ_KV.put(`conj:${runId}:pairs`, JSON.stringify(pairs));

  const recordsByNorad = new Map(records.map((r) => [r.noradId, r]));
  const precomputeChunks = Conj.chunkArray(uniqueIds, Conj.PRECOMPUTE_CHUNK_SIZE);

  for (let i = 0; i < precomputeChunks.length; i++) {
    const chunkRecords = precomputeChunks[i].map((id) => recordsByNorad.get(id));
    await env.CONJ_KV.put(`conj:${runId}:precompute-input:${i}`, JSON.stringify(chunkRecords));
  }

  await env.DB.prepare(
    `UPDATE conjunction_runs
     SET stage = 'precomputing', precompute_total = ?, candidate_pairs = ?, updated_at = ?
     WHERE run_id = ?`
  )
    .bind(precomputeChunks.length, pairs.length, nowIso(), runId)
    .run();

  for (let i = 0; i < precomputeChunks.length; i++) {
    await env.CONJ_QUEUE.send({ type: 'precompute-chunk', runId, chunkIndex: i });
  }

  return { pairs: pairs.length, uniqueIds: uniqueIds.length, precomputeChunks: precomputeChunks.length };
}

// --- Étape 4 : precompute-chunk --------------------------------------------

export async function precomputeChunk(env, message) {
  const { runId, chunkIndex } = message;
  const chunkRecords = JSON.parse(await env.CONJ_KV.get(`conj:${runId}:precompute-input:${chunkIndex}`));
  const startDate = new Date();

  for (const rec of chunkRecords) {
    const satrec = satellite.twoline2satrec(rec.line1, rec.line2);
    const positions = Conj.precomputePositions(satrec, startDate);
    const flat = [];
    for (const p of positions) {
      if (p) flat.push(p.x, p.y, p.z);
      else flat.push(null, null, null);
    }
    await env.CONJ_KV.put(
      `conj:${runId}:pos:${rec.noradId}`,
      JSON.stringify({ name: rec.name, line1: rec.line1, line2: rec.line2, startDate: startDate.toISOString(), flat })
    );
  }

  const result = await env.DB.prepare(
    `UPDATE conjunction_runs SET precompute_done = precompute_done + 1, updated_at = ?
     WHERE run_id = ? RETURNING precompute_done, precompute_total`
  )
    .bind(nowIso(), runId)
    .first();

  if (result.precompute_done === result.precompute_total) {
    const pairs = JSON.parse(await env.CONJ_KV.get(`conj:${runId}:pairs`));
    const scanChunks = Conj.chunkArray(pairs, Conj.SCAN_CHUNK_SIZE);

    await env.DB.prepare(`UPDATE conjunction_runs SET stage = 'scanning', scan_total = ? WHERE run_id = ?`)
      .bind(scanChunks.length, runId)
      .run();

    for (const chunk of scanChunks) {
      await env.CONJ_QUEUE.send({ type: 'scan-chunk', runId, pairs: chunk });
    }
  }
}

// --- Étape 5 : scan-chunk ----------------------------------------------------

function unflattenPositions(flat) {
  const positions = [];
  for (let i = 0; i < flat.length; i += 3) {
    positions.push(flat[i] == null ? null : { x: flat[i], y: flat[i + 1], z: flat[i + 2] });
  }
  return positions;
}

export async function scanChunk(env, message) {
  const { runId, pairs } = message;
  const posCache = new Map();

  const getPositionData = async (noradId) => {
    if (!posCache.has(noradId)) {
      const raw = await env.CONJ_KV.get(`conj:${runId}:pos:${noradId}`);
      posCache.set(noradId, raw ? JSON.parse(raw) : null);
    }
    return posCache.get(noradId);
  };

  const nearMisses = [];
  for (const [noradA, noradB] of pairs) {
    const dataA = await getPositionData(noradA);
    const dataB = await getPositionData(noradB);
    if (!dataA || !dataB) continue;

    const { minDist, minIndex } = Conj.coarseScanMinDistance(
      unflattenPositions(dataA.flat),
      unflattenPositions(dataB.flat)
    );

    if (minDist < Conj.REFINE_MARGIN_KM) {
      const approxDate = new Date(
        new Date(dataA.startDate).getTime() + minIndex * Conj.COARSE_STEP_MINUTES * 60000
      );
      nearMisses.push({
        noradA,
        noradB,
        nameA: dataA.name,
        nameB: dataB.name,
        lineA1: dataA.line1,
        lineA2: dataA.line2,
        lineB1: dataB.line1,
        lineB2: dataB.line2,
        approxDate: approxDate.toISOString(),
      });
    }
  }

  if (nearMisses.length > 0) {
    await env.CONJ_QUEUE.send({ type: 'refine-pairs', runId, nearMisses });
  }

  const result = await env.DB.prepare(
    `UPDATE conjunction_runs SET scan_done = scan_done + 1, updated_at = ?
     WHERE run_id = ? RETURNING scan_done, scan_total`
  )
    .bind(nowIso(), runId)
    .first();

  if (result.scan_done === result.scan_total) {
    await env.DB.prepare(`UPDATE conjunction_runs SET stage = 'done', updated_at = ? WHERE run_id = ?`)
      .bind(nowIso(), runId)
      .run();
  }
}

// --- Étape 6 : refine-pairs --------------------------------------------------

export async function refinePairs(env, message) {
  const { nearMisses } = message;
  const now = nowIso();

  const statements = [];
  for (const nm of nearMisses) {
    const satrecA = satellite.twoline2satrec(nm.lineA1, nm.lineA2);
    const satrecB = satellite.twoline2satrec(nm.lineB1, nm.lineB2);
    const refined = Conj.refineTca(satrecA, satrecB, new Date(nm.approxDate));

    if (refined.distanceKm >= Conj.DANGER_THRESHOLD_KM) continue;

    const epochA = Conj.parseTleEpochDate(nm.lineA1);
    const epochB = Conj.parseTleEpochDate(nm.lineB1);
    const tleAgeHours =
      (Date.now() - epochA.getTime() + (Date.now() - epochB.getTime())) / 2 / 3600000;

    statements.push(
      env.DB.prepare(
        `INSERT INTO conjunctions
           (object_a, object_b, object_a_name, object_b_name, tca, min_distance, rel_velocity, computed_at, tle_age_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nm.noradA,
        nm.noradB,
        nm.nameA,
        nm.nameB,
        refined.date.toISOString(),
        refined.distanceKm,
        refined.relVelocityKmS,
        now,
        tleAgeHours
      )
    );
  }

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}
