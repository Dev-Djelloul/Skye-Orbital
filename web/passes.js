const DEFAULT_WINDOW_HOURS = 72;
const DEFAULT_STEP_SECONDS = 60;
const DEFAULT_MIN_ELEVATION_DEG = 0;
const CROSSING_REFINE_ITERATIONS = 12;

// Calcule les prochains passages d'un satellite au-dessus d'un observateur,
// en balayant une fenêtre temporelle et en détectant les franchissements
// d'élévation (lever/coucher), avec suivi du maximum d'élévation (culmination).
//
// Simplification assumée : si le satellite est déjà au-dessus de l'horizon à
// `startDate`, ce passage en cours n'est pas remonté (seuls les passages dont
// le lever est capturé dans la fenêtre le sont) — se corrige de lui-même au
// recalcul suivant une fois ce passage terminé.
export function findPasses(satrec, observer, options = {}) {
  const {
    startDate = new Date(),
    windowHours = DEFAULT_WINDOW_HOURS,
    stepSeconds = DEFAULT_STEP_SECONDS,
    minElevationDeg = DEFAULT_MIN_ELEVATION_DEG,
  } = options;

  const observerGd = {
    longitude: (observer.lonDeg * Math.PI) / 180,
    latitude: (observer.latDeg * Math.PI) / 180,
    height: observer.altKm ?? 0,
  };

  const endTimeMs = startDate.getTime() + windowHours * 3600000;
  const stepMs = stepSeconds * 1000;

  const passes = [];
  let current = null;
  let prevSample = sampleLookAngle(satrec, observerGd, startDate);

  for (let t = startDate.getTime() + stepMs; t <= endTimeMs; t += stepMs) {
    const sample = sampleLookAngle(satrec, observerGd, new Date(t));
    if (!sample || !prevSample) {
      prevSample = sample;
      continue;
    }

    if (prevSample.elevationDeg < minElevationDeg && sample.elevationDeg >= minElevationDeg) {
      current = startPass(satrec, observerGd, prevSample, sample, minElevationDeg);
    }

    if (current) {
      trackCulmination(current, sample);

      if (prevSample.elevationDeg >= minElevationDeg && sample.elevationDeg < minElevationDeg) {
        passes.push(finishPass(satrec, observerGd, current, prevSample, sample, minElevationDeg));
        current = null;
      }
    }

    prevSample = sample;
  }

  return passes;
}

function sampleLookAngle(satrec, observerGd, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv?.position) return null;
  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, positionEcf);
  return {
    date,
    azimuthDeg: (look.azimuth * 180) / Math.PI,
    elevationDeg: (look.elevation * 180) / Math.PI,
    rangeKm: look.rangeSat,
  };
}

function startPass(satrec, observerGd, prevSample, sample, minElevationDeg) {
  const riseDate = refineCrossing(satrec, observerGd, prevSample.date, sample.date, minElevationDeg);
  const riseSample = sampleLookAngle(satrec, observerGd, riseDate);
  return {
    riseDate,
    riseAzimuthDeg: riseSample.azimuthDeg,
    maxElevationDeg: riseSample.elevationDeg,
    maxElevationDate: riseDate,
    maxElevationAzimuthDeg: riseSample.azimuthDeg,
  };
}

function trackCulmination(current, sample) {
  if (sample.elevationDeg > current.maxElevationDeg) {
    current.maxElevationDeg = sample.elevationDeg;
    current.maxElevationDate = sample.date;
    current.maxElevationAzimuthDeg = sample.azimuthDeg;
  }
}

function finishPass(satrec, observerGd, current, prevSample, sample, minElevationDeg) {
  const setDate = refineCrossing(satrec, observerGd, prevSample.date, sample.date, minElevationDeg);
  const setSample = sampleLookAngle(satrec, observerGd, setDate);
  return {
    riseDate: current.riseDate,
    riseAzimuthDeg: current.riseAzimuthDeg,
    maxElevationDate: current.maxElevationDate,
    maxElevationDeg: current.maxElevationDeg,
    maxElevationAzimuthDeg: current.maxElevationAzimuthDeg,
    setDate,
    setAzimuthDeg: setSample.azimuthDeg,
  };
}

// Bisection entre deux instants encadrant un franchissement du seuil d'élévation.
function refineCrossing(satrec, observerGd, t0, t1, thresholdDeg) {
  let lo = t0.getTime();
  let hi = t1.getTime();
  const loAbove = sampleLookAngle(satrec, observerGd, new Date(lo)).elevationDeg >= thresholdDeg;

  for (let i = 0; i < CROSSING_REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const midAbove = sampleLookAngle(satrec, observerGd, new Date(mid)).elevationDeg >= thresholdDeg;
    if (midAbove === loAbove) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return new Date(Math.round((lo + hi) / 2));
}
