import * as ConjPipeline from './conjunctions-pipeline.js';
import { routeChatCompletion } from './ai/modelRouter.js';
import { generateBriefing } from './briefing.js';

const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const TLE_CACHE_TTL_SECONDS = 7200; // 2h — imposé par la politique de fetch de CelesTrak
const CONJUNCTION_KICKOFF_CRON = '0 3 * * *';
const BRIEFING_CRON = '30 3 * * *';

// Groupes exposés par /tle/:group (cf. ORBITAL-WATCH-ARCHITECTURE.md §3.1)
const ALLOWED_GROUPS = new Set([
  'active',
  'stations',
  'starlink',
  'cosmos-1408-debris',
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
]);

// Phase 1 : seul "stations" est peuplé en D1 (critère de sortie de la phase).
const REFRESH_GROUPS = ['stations'];

const TLE_ROUTE_PATTERN = /^\/tle\/([a-z0-9-]+)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = TLE_ROUTE_PATTERN.exec(url.pathname);

    if (request.method === 'GET' && match) {
      const group = match[1].toLowerCase();
      if (!ALLOWED_GROUPS.has(group)) {
        return jsonResponse({ error: `Groupe inconnu: ${group}` }, 400);
      }
      try {
        const result = await getCachedOrFetchTle(env, group);
        return jsonResponse(result, 200);
      } catch (err) {
        return jsonResponse({ error: err.message }, 502);
      }
    }

    if (request.method === 'GET' && url.pathname === '/conjunctions') {
      return getConjunctions(env);
    }

    if (request.method === 'GET' && url.pathname === '/briefing') {
      return getLatestBriefing(env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },

  async scheduled(event, env) {
    if (event.cron === CONJUNCTION_KICKOFF_CRON) {
      try {
        await ConjPipeline.kickoff(env, getCachedOrFetchTle);
      } catch (err) {
        console.error(`Échec du kickoff de screening de conjonctions: ${err.message}`);
      }
      return;
    }

    if (event.cron === BRIEFING_CRON) {
      try {
        await runDailyBriefing(env);
      } catch (err) {
        console.error(`Échec de la génération du briefing quotidien: ${err.message}`);
      }
      return;
    }

    for (const group of REFRESH_GROUPS) {
      try {
        const result = await getCachedOrFetchTle(env, group, { forceRefresh: true });
        if (group === 'stations') {
          await upsertObjects(env, result.objects);
        }
      } catch (err) {
        console.error(`Échec du rafraîchissement TLE pour "${group}": ${err.message}`);
      }
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await handleConjunctionMessage(env, message.body);
        message.ack();
      } catch (err) {
        console.error(`Échec message "${message.body?.type}": ${err.message}`);
        message.retry();
      }
    }
  },
};

async function handleConjunctionMessage(env, body) {
  switch (body.type) {
    case 'parse-chunk':
      return ConjPipeline.parseChunk(env, body);
    case 'bin-and-dispatch':
      return ConjPipeline.binAndDispatch(env, body);
    case 'precompute-chunk':
      return ConjPipeline.precomputeChunk(env, body);
    case 'scan-chunk':
      return ConjPipeline.scanChunk(env, body);
    case 'refine-pairs':
      return ConjPipeline.refinePairs(env, body);
    default:
      throw new Error(`Type de message inconnu: ${body.type}`);
  }
}

async function runDailyBriefing(env) {
  const date = new Date().toISOString().slice(0, 10);
  const { content, modelUsed } = await generateBriefing(env, { getCachedOrFetchTle, routeChatCompletion });

  await env.DB.prepare(
    `INSERT INTO briefings (date, content, model_used, generated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       content = excluded.content,
       model_used = excluded.model_used,
       generated_at = excluded.generated_at`
  )
    .bind(date, content, modelUsed, new Date().toISOString())
    .run();
}

async function getLatestBriefing(env) {
  const result = await env.DB.prepare(`SELECT date, content, model_used, generated_at FROM briefings ORDER BY date DESC LIMIT 1`).first();

  if (!result) {
    return jsonResponse({ briefing: null }, 200);
  }

  return jsonResponse({ briefing: result }, 200);
}

async function getConjunctions(env) {
  // tca est stocké au format toISOString() JS ('...T...Z') — le comparer à
  // datetime('now') de SQLite (format '... ...', sans T/Z) donnerait un tri
  // de chaînes incorrect ; on borne donc avec un timestamp ISO JS identique.
  const result = await env.DB.prepare(
    `SELECT id, object_a, object_a_name, object_b, object_b_name,
            tca, min_distance, rel_velocity, computed_at, tle_age_hours
     FROM conjunctions
     WHERE tca >= ?
     ORDER BY tca ASC
     LIMIT 200`
  )
    .bind(new Date().toISOString())
    .all();

  return jsonResponse({ conjunctions: result.results }, 200);
}

async function getCachedOrFetchTle(env, group, { forceRefresh = false } = {}) {
  const cacheKey = `tle:${group}`;
  // Copie "dernier bon jeu connu", SANS expiration. Le cache 2h (`cacheKey`)
  // sert de signal de fraîcheur/politique CelesTrak ; ce filet de secours
  // garantit qu'on a toujours de la donnée à servir même si CelesTrak
  // throttle (502/522) après l'expiration du cache — sinon l'app se retrouve
  // sans aucune donnée et reste bloquée (cf. incident du 2026-07-21).
  const lkgKey = `tle:${group}:lkg`;

  if (!forceRefresh) {
    const cached = await env.TLE_CACHE.get(cacheKey, 'json');
    if (cached) {
      // Backfill unique du filet de secours à partir d'un cache déjà chaud
      // (les caches créés avant l'introduction du LKG n'en ont pas encore).
      if (!(await env.TLE_CACHE.get(lkgKey))) {
        await env.TLE_CACHE.put(lkgKey, JSON.stringify(cached));
      }
      return { ...cached, cached: true };
    }
  }

  const url = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;
  let res;
  try {
    res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'orbital-watch-worker/1.0' },
    });
  } catch (err) {
    const stale = await env.TLE_CACHE.get(lkgKey, 'json');
    if (stale) return { ...stale, cached: true, stale: true };
    throw err;
  }
  if (!res.ok) {
    const stale = await env.TLE_CACHE.get(lkgKey, 'json');
    if (stale) return { ...stale, cached: true, stale: true };
    throw new Error(`CelesTrak a répondu ${res.status} pour le groupe "${group}"`);
  }

  const text = await res.text();
  const objects = parseTleText(text);
  // Réponse vide/tronquée : ne pas écraser un bon cache avec du vide.
  if (objects.length === 0) {
    const stale = await env.TLE_CACHE.get(lkgKey, 'json');
    if (stale) return { ...stale, cached: true, stale: true };
  }
  const payload = { group, objects, fetchedAt: new Date().toISOString() };

  await env.TLE_CACHE.put(cacheKey, JSON.stringify(payload), {
    expirationTtl: TLE_CACHE_TTL_SECONDS,
  });
  await env.TLE_CACHE.put(lkgKey, JSON.stringify(payload));

  return { ...payload, cached: false };
}

// CelesTrak renvoie parfois des 5xx transitoires sur les gros groupes (ex: 522) — 1 nouvelle tentative suffit.
async function fetchWithRetry(url, options, retries = 1, delayMs = 500) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function parseTleText(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const objects = [];
  for (let i = 0; i < lines.length; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1]?.trim();
    const line2 = lines[i + 2]?.trim();
    if (!name || !line1 || !line2 || !line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      continue;
    }
    objects.push({ name, line1, line2 });
  }
  return objects;
}

function parseNoradId(line1) {
  return Number.parseInt(line1.substring(2, 7), 10);
}

function parseTleEpoch(line1) {
  const yy = Number.parseInt(line1.substring(18, 20), 10);
  const dayFrac = Number.parseFloat(line1.substring(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const startOfYear = Date.UTC(year, 0, 1);
  return new Date(startOfYear + (dayFrac - 1) * 86400000).toISOString();
}

async function upsertObjects(env, objects) {
  const now = new Date().toISOString();
  const statements = objects.map((obj) =>
    env.DB.prepare(
      `INSERT INTO objects (norad_id, name, tle_line1, tle_line2, tle_epoch, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(norad_id) DO UPDATE SET
         name = excluded.name,
         tle_line1 = excluded.tle_line1,
         tle_line2 = excluded.tle_line2,
         tle_epoch = excluded.tle_epoch,
         updated_at = excluded.updated_at`
    ).bind(parseNoradId(obj.line1), obj.name, obj.line1, obj.line2, parseTleEpoch(obj.line1), now)
  );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
  });
}
