// Logique pure du screening de conjonctions (Module C / Phase 5).
// Aucune dépendance Cloudflare ici — testable indépendamment en Node.
// Dépend du global `satellite` (satellite.js), fourni par l'environnement
// d'exécution (Worker ou script de test), comme le reste du projet.

export const MU_EARTH = 398600.4418; // km^3/s^2, paramètre gravitationnel terrestre
export const EARTH_RADIUS_KM = 6378.137;

export const ALT_MARGIN_KM = 10;
export const INCL_MARGIN_DEG = 2;
export const BIN_WIDTH_KM = 50;
export const COARSE_STEP_MINUTES = 10;
export const WINDOW_HOURS = 72;
export const REFINE_MARGIN_KM = 25; // seuil pour déclencher l'affinage fin du TCA
export const DANGER_THRESHOLD_KM = 5; // seuil de rapprochement retenu (cf. spec)
// Tailles de lot dimensionnées sur des mesures à froid (process Node neuf,
// JIT non préchauffé) — le scénario réaliste pour l'exécution d'un message
// de Queue, plutôt que sur des mesures "à chaud" après des dizaines de
// milliers d'appels dans le même process, bien plus optimistes (~4x).
// À ajuster si besoin après observation des métriques CPU réelles en prod.
export const PARSE_CHUNK_SIZE = 200; // ~34µs/objet à froid -> ~6.8ms
export const PRECOMPUTE_CHUNK_SIZE = 5; // ~1.55ms/objet à froid -> ~7.75ms
export const SCAN_CHUNK_SIZE = 400; // ~17.5µs/paire à froid -> ~7ms
export const REFINE_CHUNK_SIZE = 5; // ~1.2ms/paire à froid -> ~6ms

export function parseNoradId(line1) {
  return Number.parseInt(line1.substring(2, 7), 10);
}

export function parseTleEpochDate(line1) {
  const yy = Number.parseInt(line1.substring(18, 20), 10);
  const dayFrac = Number.parseFloat(line1.substring(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const startOfYear = Date.UTC(year, 0, 1);
  return new Date(startOfYear + (dayFrac - 1) * 86400000);
}

export function computeOrbitalElements(satrec) {
  const meanMotionRadPerSec = satrec.no / 60;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH / (meanMotionRadPerSec * meanMotionRadPerSec));
  const e = satrec.ecco;
  return {
    perigeeAlt: semiMajorAxisKm * (1 - e) - EARTH_RADIUS_KM,
    apogeeAlt: semiMajorAxisKm * (1 + e) - EARTH_RADIUS_KM,
    inclDeg: (satrec.inclo * 180) / Math.PI,
  };
}

// Construit un enregistrement catalogue à partir d'un TLE brut {name, line1, line2}.
// Retourne null si le TLE est invalide (satrec.error !== 0).
export function buildRecord(obj, group) {
  const satrec = satellite.twoline2satrec(obj.line1, obj.line2);
  if (satrec.error !== 0) return null;
  const { perigeeAlt, apogeeAlt, inclDeg } = computeOrbitalElements(satrec);
  return {
    noradId: parseNoradId(obj.line1),
    name: obj.name,
    group,
    line1: obj.line1,
    line2: obj.line2,
    perigeeAlt,
    apogeeAlt,
    inclDeg,
  };
}

export function binIndexForAltitude(altKm) {
  return Math.floor(altKm / BIN_WIDTH_KM);
}

// Regroupe des enregistrements par bande d'altitude de périgée (clé = index de bande).
export function buildBins(records) {
  const bins = new Map();
  for (const r of records) {
    const idx = binIndexForAltitude(r.perigeeAlt);
    if (!bins.has(idx)) bins.set(idx, []);
    bins.get(idx).push(r);
  }
  return bins;
}

export function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function altitudeOverlap(a, b) {
  return a.perigeeAlt <= b.apogeeAlt + ALT_MARGIN_KM && b.perigeeAlt <= a.apogeeAlt + ALT_MARGIN_KM;
}

function inclinationClose(a, b) {
  return Math.abs(a.inclDeg - b.inclDeg) <= INCL_MARGIN_DEG;
}

// Une paire n'est candidate que si les objets viennent de groupes différents
// (exclusion des paires intra-nuage de débris / intra-constellation — le
// point chaud identifié empiriquement) et que leurs bandes orbitales se
// chevauchent (filtre grossier, cf. spec "filtre sur la géométrie orbitale").
export function isCandidatePair(a, b) {
  if (a.group === b.group) return false;
  return altitudeOverlap(a, b) && inclinationClose(a, b);
}

// Précalcule les positions ECI (km) d'un satrec sur la fenêtre de screening,
// à résolution fixe — le coût de propagation est ainsi payé une seule fois
// par objet, jamais recalculé par paire.
export function precomputePositions(satrec, startDate, stepMinutes = COARSE_STEP_MINUTES, windowHours = WINDOW_HOURS) {
  const totalSteps = Math.floor((windowHours * 60) / stepMinutes);
  const positions = new Array(totalSteps + 1);
  for (let i = 0; i <= totalSteps; i++) {
    const date = new Date(startDate.getTime() + i * stepMinutes * 60000);
    const pv = satellite.propagate(satrec, date);
    positions[i] = pv?.position ?? null;
  }
  return positions;
}

export function distanceKm(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

// Balayage grossier à partir de positions déjà précalculées (pas de nouvel
// appel SGP4 ici) : distance minimale observée + index de l'échantillon.
export function coarseScanMinDistance(positionsA, positionsB) {
  let minDist = Number.POSITIVE_INFINITY;
  let minIndex = -1;
  const len = Math.min(positionsA.length, positionsB.length);
  for (let i = 0; i < len; i++) {
    const pa = positionsA[i];
    const pb = positionsB[i];
    if (!pa || !pb) continue;
    const d = distanceKm(pa, pb);
    if (d < minDist) {
      minDist = d;
      minIndex = i;
    }
  }
  return { minDist, minIndex };
}

// Énumère les paires candidates à partir des bandes d'altitude (chaque bande
// comparée à elle-même et à la bande immédiatement supérieure, pour ne pas
// manquer les chevauchements en bordure — chaque paire n'est ainsi produite
// qu'une seule fois). Ne retourne que des paires de NORAD ID : bon marché à
// énumérer même à plusieurs dizaines de milliers, contrairement à des
// enregistrements complets par paire.
export function collectCandidatePairs(bins) {
  const pairs = [];
  const sortedBinIds = [...bins.keys()].sort((a, b) => a - b);

  for (const binId of sortedBinIds) {
    const own = bins.get(binId) ?? [];
    const neighbor = bins.get(binId + 1) ?? [];
    collectPairsWithin(own, pairs);
    collectPairsAcross(own, neighbor, pairs);
  }

  return pairs;
}

function collectPairsWithin(records, pairs) {
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (isCandidatePair(records[i], records[j])) pairs.push([records[i].noradId, records[j].noradId]);
    }
  }
}

function collectPairsAcross(recordsA, recordsB, pairs) {
  for (const a of recordsA) {
    for (const b of recordsB) {
      if (isCandidatePair(a, b)) pairs.push([a.noradId, b.noradId]);
    }
  }
}

export function collectUniqueNoradIds(pairs) {
  const ids = new Set();
  for (const [a, b] of pairs) {
    ids.add(a);
    ids.add(b);
  }
  return ids;
}

// Affine le TCA autour d'un instant approximatif par resserrement successif
// de la fenêtre de recherche (quelques centaines de propagations, réservé
// aux paires qui ont déjà passé le filtre grossier).
export function refineTca(satrecA, satrecB, approxDate, initialHalfWindowMinutes = COARSE_STEP_MINUTES) {
  const ROUNDS = 4;
  const SAMPLES_PER_ROUND = 20;

  let center = approxDate.getTime();
  let halfWindowMs = initialHalfWindowMinutes * 60000;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestTime = center;

  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i <= SAMPLES_PER_ROUND; i++) {
      const t = center - halfWindowMs + (2 * halfWindowMs * i) / SAMPLES_PER_ROUND;
      const date = new Date(t);
      const pvA = satellite.propagate(satrecA, date);
      const pvB = satellite.propagate(satrecB, date);
      if (!pvA?.position || !pvB?.position) continue;
      const d = distanceKm(pvA.position, pvB.position);
      if (d < bestDist) {
        bestDist = d;
        bestTime = t;
      }
    }
    center = bestTime;
    halfWindowMs /= 4;
  }

  const finalDate = new Date(bestTime);
  const pvA = satellite.propagate(satrecA, finalDate);
  const pvB = satellite.propagate(satrecB, finalDate);
  const relVelocityKmS =
    pvA?.velocity && pvB?.velocity ? distanceKm(pvA.velocity, pvB.velocity) : null;

  return { date: finalDate, distanceKm: bestDist, relVelocityKmS };
}
