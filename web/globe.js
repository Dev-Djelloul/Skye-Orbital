const COLOR_ACTIVE = Cesium.Color.fromCssColorString('#38e1f2');
const COLOR_STATION = Cesium.Color.fromCssColorString('#4ade80');
const COLOR_DEBRIS_RECENT = Cesium.Color.fromCssColorString('#f0475a'); // Cosmos-1408 ASAT (2021)
const COLOR_DEBRIS_OLDER = Cesium.Color.fromCssColorString('#fb7a3c'); // Fengyun-1C / Iridium-Cosmos
const COLOR_SELECTED = Cesium.Color.fromCssColorString('#ffd27a');
const TRACK_BASE_COLOR = Cesium.Color.fromCssColorString('#ffd27a');

const AUTO_ROTATE_RAD_PER_FRAME = 0.0006;
const READY_TIMEOUT_MS = 8000;
const FLY_TO_HEIGHT_METERS = 1500000;
const FLY_TO_DURATION_SECONDS = 1.5;
const GROUND_TRACK_SEGMENTS = 24;
const SKYBOX_FACE_SIZE = 512;
const GLOW_SPRITE_SIZE = 64;

let viewer = null;
let points = null;
let labels = null;
let billboards = null;
let selectedLabel = null;
let selectedGlow = null;
let glowImage = null;
let groundTrackSegments = [];
let entriesByNoradId = new Map();
let autoRotate = true;

export async function initGlobe(containerId, onSelect) {
  viewer = new Cesium.Viewer(containerId, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });

  const imageryProvider = await Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
  );
  viewer.imageryLayers.addImageryProvider(imageryProvider);
  viewer.scene.skyBox = buildSkyBox();

  points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  labels = viewer.scene.primitives.add(new Cesium.LabelCollection());
  billboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
  glowImage = createGlowSprite();

  const trackCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  groundTrackSegments = [];
  for (let i = 0; i < GROUND_TRACK_SEGMENTS; i++) {
    const alpha = 0.1 + (i / (GROUND_TRACK_SEGMENTS - 1)) * 0.7;
    groundTrackSegments.push(
      trackCollection.add({
        positions: [],
        width: 2,
        material: Cesium.Material.fromType('Color', { color: TRACK_BASE_COLOR.withAlpha(alpha) }),
      })
    );
  }

  setupCamera();
  setupPicking(onSelect);

  await waitForFirstTilesLoaded();
}

function setupCamera() {
  viewer.scene.postRender.addEventListener(() => {
    if (autoRotate) {
      viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -AUTO_ROTATE_RAD_PER_FRAME);
    }
  });

  const stopAutoRotate = () => {
    autoRotate = false;
  };
  viewer.scene.canvas.addEventListener('pointerdown', stopAutoRotate);
  viewer.scene.canvas.addEventListener('wheel', stopAutoRotate);
}

function setupPicking(onSelect) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click) => {
    const picked = viewer.scene.pick(click.position);
    if (picked && picked.id !== undefined && typeof onSelect === 'function') {
      onSelect(picked.id);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function waitForFirstTilesLoaded() {
  return new Promise((resolve) => {
    let resolved = false;
    let sawPending = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const timeoutId = setTimeout(finish, READY_TIMEOUT_MS);

    viewer.scene.globe.tileLoadProgressEvent.addEventListener(function listener(remaining) {
      if (remaining > 0) sawPending = true;
      if (sawPending && remaining === 0) {
        clearTimeout(timeoutId);
        finish();
      }
    });
  });
}

// Couleur par catégorie — cohérente avec la légende du panneau de filtres.
// Deux nuances de débris : rouge pour l'événement le plus récent/agressif
// (Cosmos-1408, 2021), orange pour les nuages plus anciens (Fengyun-1C,
// collision Iridium-33/Cosmos-2251).
function getCategoryColor(sat) {
  if (sat.category === 'active') return COLOR_ACTIVE;
  if (sat.category === 'stations') return COLOR_STATION;
  if (sat.category === 'debris') {
    return sat.originEvent === 'COSMOS-1408 ASAT (2021)' ? COLOR_DEBRIS_RECENT : COLOR_DEBRIS_OLDER;
  }
  return COLOR_ACTIVE;
}

export function updatePositions(satellites, selectedNoradId) {
  const seen = new Set();
  let selectedSat = null;

  for (const sat of satellites) {
    if (!sat.current) continue;
    seen.add(sat.noradId);

    const isSelected = sat.noradId === selectedNoradId;
    const position = upsertPoint(sat, isSelected);
    if (isSelected) selectedSat = { sat, position };
  }

  removeStalePoints(seen);
  updateSelectedLabel(selectedSat);
  updateSelectedGlow(selectedSat);
}

function upsertPoint(sat, isSelected) {
  const position = Cesium.Cartesian3.fromDegrees(
    sat.current.longitudeDeg,
    sat.current.latitudeDeg,
    sat.current.altitudeKm * 1000
  );
  const color = isSelected ? COLOR_SELECTED : getCategoryColor(sat);
  const pixelSize = isSelected ? 11 : 6;

  const entry = entriesByNoradId.get(sat.noradId);
  if (!entry) {
    const point = points.add({
      position,
      color,
      pixelSize,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      id: sat.noradId,
    });
    entriesByNoradId.set(sat.noradId, { point });
  } else {
    entry.point.position = position;
    entry.point.color = color;
    entry.point.pixelSize = pixelSize;
  }

  return position;
}

function removeStalePoints(seen) {
  for (const [noradId, entry] of entriesByNoradId) {
    if (!seen.has(noradId)) {
      points.remove(entry.point);
      entriesByNoradId.delete(noradId);
    }
  }
}

// Un seul label GPU, repositionné sur l'objet sélectionné — évite de générer
// une texture de glyphes par objet (inutile : au plus un label visible à la fois).
function updateSelectedLabel(selectedSat) {
  if (!selectedSat) {
    if (selectedLabel) selectedLabel.show = false;
    return;
  }

  if (!selectedLabel) {
    selectedLabel = labels.add({
      position: selectedSat.position,
      text: selectedSat.sat.name,
      font: '12px monospace',
      fillColor: Cesium.Color.fromCssColorString('#e4ebfa'),
      pixelOffset: new Cesium.Cartesian2(10, 0),
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      scale: 0.9,
    });
  } else {
    selectedLabel.position = selectedSat.position;
    selectedLabel.text = selectedSat.sat.name;
    selectedLabel.show = true;
  }
}

// Halo doré derrière l'objet sélectionné — sprite généré une fois via canvas
// (dégradé radial), pas d'asset externe. Un seul billboard, jamais recréé.
function updateSelectedGlow(selectedSat) {
  if (!selectedSat) {
    if (selectedGlow) selectedGlow.show = false;
    return;
  }

  if (!selectedGlow) {
    selectedGlow = billboards.add({
      position: selectedSat.position,
      image: glowImage,
      scale: 1,
      color: Cesium.Color.fromCssColorString('#ffd27a').withAlpha(0.85),
    });
  } else {
    selectedGlow.position = selectedSat.position;
    selectedGlow.show = true;
  }
}

function createGlowSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_SPRITE_SIZE;
  canvas.height = GLOW_SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  const c = GLOW_SPRITE_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.25, 'rgba(255,230,180,0.55)');
  gradient.addColorStop(1, 'rgba(255,210,122,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  return canvas;
}

// Recentre/zoome la caméra sur un point donné (utilisé par la recherche) et
// coupe la rotation automatique — un vol vers un objet précis présuppose que
// l'utilisateur veut l'observer, pas le voir dériver hors champ juste après.
export function flyTo(lonDeg, latDeg) {
  autoRotate = false;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, FLY_TO_HEIGHT_METERS),
    duration: FLY_TO_DURATION_SECONDS,
  });
}

// Trace au sol en dégradé : la fenêtre (passé -> futur) est répartie sur N
// segments à alpha croissant, chacun repris de la fin du précédent pour
// éviter tout hiatus visuel — plus vif vers l'avant, indiquant le sens de
// déplacement.
export function updateGroundTrack(trackPoints) {
  if (!trackPoints || trackPoints.length < 2) {
    for (const seg of groundTrackSegments) seg.positions = [];
    return;
  }

  const positions = trackPoints.map((p) =>
    Cesium.Cartesian3.fromDegrees(p.longitudeDeg, p.latitudeDeg, p.altitudeKm * 1000)
  );
  const segCount = groundTrackSegments.length;
  const pointsPerSeg = Math.ceil(positions.length / segCount);

  for (let i = 0; i < segCount; i++) {
    const start = Math.max(0, i * pointsPerSeg - 1);
    const end = Math.min(positions.length, (i + 1) * pointsPerSeg);
    groundTrackSegments[i].positions = positions.slice(start, end);
  }
}

// --- Skybox décoratif : étoiles + Voie lactée diffuse + planètes hors
// échelle, cuites dans les 6 faces du cube — zéro coût par frame, zéro
// interférence avec la sélection/le rendu des objets réels suivis.

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  return {
    r: Number.parseInt(v.substring(0, 2), 16),
    g: Number.parseInt(v.substring(2, 4), 16),
    b: Number.parseInt(v.substring(4, 6), 16),
  };
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function drawStarfield(ctx, w, h) {
  const starCount = Math.floor((w * h) / 850);
  for (let i = 0; i < starCount; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = Math.random() * Math.random() * 1.5 + 0.25;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.65})`;
    ctx.fill();
  }

  const brightCount = Math.floor(starCount * 0.015);
  for (let i = 0; i < brightCount; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 1 + Math.random() * 1.1;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMilkyWayBand(ctx, w, h) {
  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.3);
  const band = ctx.createLinearGradient(0, -h * 0.4, 0, h * 0.4);
  band.addColorStop(0, 'rgba(190,200,230,0)');
  band.addColorStop(0.5, 'rgba(200,210,240,0.07)');
  band.addColorStop(1, 'rgba(190,200,230,0)');
  ctx.fillStyle = band;
  ctx.fillRect(-w, -h * 0.4, w * 2, h * 0.8);
  ctx.restore();
}

function drawPlanet(ctx, x, y, r, color, withRing) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  halo.addColorStop(0, rgba(color, 0.22));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  if (withRing) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.9, r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const sphere = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  sphere.addColorStop(0, shade(color, 55));
  sphere.addColorStop(1, shade(color, -60));
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Une à deux planètes par face suffisent — dispersées sur quelques faces
// seulement pour rester discrètes (découvertes en tournant/dézoomant),
// jamais toutes visibles à la fois. Hors échelle, purement décoratif.
const FACE_PLANETS = {
  positiveX: [{ color: '#c9a877', ring: true }], // Saturne
  negativeX: [{ color: '#c1552c' }], // Mars
  positiveY: [{ color: '#e4c988' }], // Vénus
  negativeY: [],
  positiveZ: [{ color: '#c9a06a' }], // Jupiter
  negativeZ: [{ color: '#a79a8e' }], // Mercure
};

function buildFaceCanvas(planetsForFace) {
  const canvas = document.createElement('canvas');
  canvas.width = SKYBOX_FACE_SIZE;
  canvas.height = SKYBOX_FACE_SIZE;
  const ctx = canvas.getContext('2d');
  const w = SKYBOX_FACE_SIZE;
  const h = SKYBOX_FACE_SIZE;

  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, w, h);

  drawMilkyWayBand(ctx, w, h);
  drawStarfield(ctx, w, h);

  for (const planet of planetsForFace) {
    const x = (0.2 + Math.random() * 0.6) * w;
    const y = (0.2 + Math.random() * 0.6) * h;
    const r = (planet.ring ? 0.045 : 0.035) * w;
    drawPlanet(ctx, x, y, r, planet.color, Boolean(planet.ring));
  }

  return canvas.toDataURL('image/png');
}

function buildSkyBox() {
  const sources = {};
  for (const face of Object.keys(FACE_PLANETS)) {
    sources[face] = buildFaceCanvas(FACE_PLANETS[face]);
  }
  return new Cesium.SkyBox({ sources });
}
