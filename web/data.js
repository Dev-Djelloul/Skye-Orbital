export const API_BASE = 'https://orbital-api.djelloulabid75.workers.dev';
export const GROUP = 'stations';

// Groupes chargés en Phase 3. "active" est écarté (cf. plan) : ~16 000 objets,
// réponses CelesTrak lentes (10s+) et sujettes à des 522 — starlink suffit
// largement à dépasser le seuil de 5000 objets et est plus fiable.
export const GROUPS = [
  { key: 'stations', label: 'Stations', category: 'stations', originEvent: null },
  { key: 'starlink', label: 'Actifs (Starlink)', category: 'active', originEvent: null },
  {
    key: 'cosmos-1408-debris',
    label: 'Débris Cosmos-1408',
    category: 'debris',
    originEvent: 'COSMOS-1408 ASAT (2021)',
  },
  {
    key: 'fengyun-1c-debris',
    label: 'Débris Fengyun-1C',
    category: 'debris',
    originEvent: 'FENGYUN-1C ASAT (2007)',
  },
  {
    key: 'iridium-33-debris',
    label: 'Débris Iridium-33',
    category: 'debris',
    originEvent: 'Collision Iridium-33/Cosmos-2251 (2009)',
  },
  {
    key: 'cosmos-2251-debris',
    label: 'Débris Cosmos-2251',
    category: 'debris',
    originEvent: 'Collision Iridium-33/Cosmos-2251 (2009)',
  },
];

export async function fetchSatellites(group = GROUP) {
  const res = await fetch(`${API_BASE}/tle/${group}`);
  if (!res.ok) {
    throw new Error(`Erreur API (${res.status})`);
  }
  const data = await res.json();

  const satellites = data.objects
    .map((obj) => buildSatellite(obj))
    .filter(Boolean);

  return { fetchedAt: data.fetchedAt, satellites };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un groupe peut échouer transitoirement (Worker froid, 502 si CelesTrak
// throttle avant que le filet de secours ne prenne le relais, blip réseau).
// On réessaie avec un backoff court avant d'abandonner le groupe.
async function fetchGroupWithRetry(groupConfig, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API_BASE}/tle/${groupConfig.key}`);
      if (!res.ok) throw new Error(`Erreur API (${res.status}) pour "${groupConfig.key}"`);
      const data = await res.json();
      return { groupConfig, data };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(700 * (i + 1));
    }
  }
  throw lastErr;
}

// Charge tous les groupes de `GROUPS` en parallèle et tague chaque objet
// avec sa catégorie/événement d'origine pour le filtrage côté client.
export async function fetchAllGroups(groups = GROUPS) {
  const results = await Promise.allSettled(
    groups.map((groupConfig) => fetchGroupWithRetry(groupConfig))
  );

  const satellites = [];
  const fetchedAtByGroup = {};
  const failedGroups = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      failedGroups.push(result.reason?.message ?? String(result.reason));
      continue;
    }
    const { groupConfig, data } = result.value;
    fetchedAtByGroup[groupConfig.key] = data.fetchedAt;
    for (const obj of data.objects) {
      const sat = buildSatellite(obj, groupConfig);
      if (sat) satellites.push(sat);
    }
  }

  return { satellites, fetchedAtByGroup, failedGroups };
}

function buildSatellite(obj, groupConfig = null) {
  const satrec = satellite.twoline2satrec(obj.line1, obj.line2);
  if (satrec.error !== 0) return null;
  return {
    name: obj.name,
    line1: obj.line1,
    line2: obj.line2,
    satrec,
    noradId: parseNoradId(obj.line1),
    intlDesignator: parseIntlDesignator(obj.line1),
    epochDate: parseTleEpochDate(obj.line1),
    category: groupConfig?.category ?? null,
    originEvent: groupConfig?.originEvent ?? null,
    group: groupConfig?.key ?? null,
  };
}

export function propagateGeodetic(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv?.position) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  return {
    latitudeDeg: satellite.degreesLat(geo.latitude),
    longitudeDeg: satellite.degreesLong(geo.longitude),
    altitudeKm: geo.height,
  };
}

// Échantillonne la trace au sol sur ±1 orbite autour de `now`.
export function sampleGroundTrack(satrec, now, steps = 120) {
  const periodMinutes = (2 * Math.PI) / satrec.no;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const offsetMin = -periodMinutes + (2 * periodMinutes * i) / steps;
    const t = new Date(now.getTime() + offsetMin * 60000);
    const pos = propagateGeodetic(satrec, t);
    if (pos) points.push(pos);
  }
  return points;
}

export function orbitalPeriodMinutes(satrec) {
  return (2 * Math.PI) / satrec.no;
}

export function inclinationDeg(satrec) {
  return (satrec.inclo * 180) / Math.PI;
}

export function parseNoradId(line1) {
  return Number.parseInt(line1.substring(2, 7), 10);
}

export function parseIntlDesignator(line1) {
  return line1.substring(9, 17).trim();
}

export function parseTleEpochDate(line1) {
  const yy = Number.parseInt(line1.substring(18, 20), 10);
  const dayFrac = Number.parseFloat(line1.substring(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const startOfYear = Date.UTC(year, 0, 1);
  return new Date(startOfYear + (dayFrac - 1) * 86400000);
}

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 48) return `${hours} h ${min} min`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}
