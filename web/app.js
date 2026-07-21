import * as Data from './data.js';
import * as Globe from './globe.js';
import * as Passes from './passes.js';
import { getStationMetadata } from './station-metadata.js';

const REFRESH_MS = 1000;
const PASSES_REFRESH_MS = 60000;
const MAX_SEARCH_RESULTS = 20;

const statusEl = document.getElementById('status');
const objectDetailEl = document.getElementById('objectDetail');
const loaderEl = document.getElementById('loader');
const debrisEventsEl = document.getElementById('debrisEvents');
const obsLatInput = document.getElementById('obsLat');
const obsLonInput = document.getElementById('obsLon');
const obsGeolocateBtn = document.getElementById('obsGeolocate');
const obsStatusEl = document.getElementById('obsStatus');
const passesSectionEl = document.getElementById('passesSection');
const passesTableBodyEl = document.getElementById('passesTableBody');
const searchInput = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');
const searchBoxEl = document.getElementById('searchBox');
const conjunctionsBtn = document.getElementById('conjunctionsBtn');
const conjunctionsModal = document.getElementById('conjunctionsModal');
const conjunctionsClose = document.getElementById('conjunctionsClose');
const conjunctionsBody = document.getElementById('conjunctionsBody');
const briefingBtn = document.getElementById('briefingBtn');
const briefingModal = document.getElementById('briefingModal');
const briefingClose = document.getElementById('briefingClose');
const briefingBody = document.getElementById('briefingBody');

const state = {
  satellites: [],
  selectedNoradId: null,
  fetchedAtByGroup: {},
  filters: {
    active: true,
    stations: true,
    debris: true,
    debrisEvents: new Set(debrisEventOptions()),
  },
  observer: null, // { latDeg, lonDeg }
};

init();

async function init() {
  buildFilterPanel();
  wireFilterEvents();
  wireObserverEvents();
  wireSearchEvents();
  wireConjunctionsModal();
  wireBriefingModal();

  await Globe.initGlobe('cesiumContainer', onSelect);
  setInterval(tick, REFRESH_MS);
  setInterval(recomputePasses, PASSES_REFRESH_MS);

  await loadSatelliteData();
}

// Chargement (et rechargement) des données satellites. Séparé de l'init du
// globe pour être réessayable : si tout échoue, on affiche une erreur avec un
// bouton plutôt que de laisser l'app bloquée à vie sur « Chargement… ».
async function loadSatelliteData() {
  setLoader('<div class="spinner"></div><p>Chargement des données…</p>');
  loaderEl.style.display = '';

  let tleData;
  try {
    tleData = await Data.fetchAllGroups();
  } catch (err) {
    showLoadError();
    return;
  }

  if (tleData.satellites.length === 0) {
    showLoadError();
    return;
  }

  state.satellites = tleData.satellites;
  state.fetchedAtByGroup = tleData.fetchedAtByGroup;
  if (tleData.failedGroups.length > 0) {
    console.warn('Groupes en échec:', tleData.failedGroups);
  }
  loaderEl.style.display = 'none';
  selectDefault();
  tick();
}

function setLoader(html) {
  loaderEl.innerHTML = html;
}

function showLoadError() {
  loaderEl.style.display = '';
  setLoader(
    '<p>Impossible de charger les données pour le moment.<br>Le service de données est peut-être momentanément indisponible.</p>' +
      '<button id="retryLoadBtn" type="button">Réessayer</button>'
  );
  document.getElementById('retryLoadBtn').addEventListener('click', loadSatelliteData);
}

function debrisEventOptions() {
  return [...new Set(Data.GROUPS.filter((g) => g.category === 'debris').map((g) => g.originEvent))];
}

function buildFilterPanel() {
  debrisEventsEl.innerHTML = debrisEventOptions()
    .map(
      (ev) => `<label class="sub"><input type="checkbox" data-event="${escapeHtml(ev)}" checked> ${escapeHtml(ev)}</label>`
    )
    .join('');
}

function wireFilterEvents() {
  document.getElementById('filter-active').addEventListener('change', (e) => {
    state.filters.active = e.target.checked;
  });
  document.getElementById('filter-stations').addEventListener('change', (e) => {
    state.filters.stations = e.target.checked;
  });
  document.getElementById('filter-debris').addEventListener('change', (e) => {
    state.filters.debris = e.target.checked;
  });
  debrisEventsEl.addEventListener('change', (e) => {
    const event = e.target.dataset.event;
    if (!event) return;
    if (e.target.checked) {
      state.filters.debrisEvents.add(event);
    } else {
      state.filters.debrisEvents.delete(event);
    }
  });
}

function isVisible(sat) {
  if (sat.category === 'active') return state.filters.active;
  if (sat.category === 'stations') return state.filters.stations;
  if (sat.category === 'debris') return state.filters.debris && state.filters.debrisEvents.has(sat.originEvent);
  return true;
}

function selectDefault() {
  const iss = state.satellites.find((s) => s.noradId === 25544);
  state.selectedNoradId = iss ? iss.noradId : (state.satellites[0]?.noradId ?? null);
}

function onSelect(noradId) {
  state.selectedNoradId = noradId;
  updateDetail(new Date());
  recomputePasses();
}

const MODAL_CLOSE_TRANSITION_MS = 220;

function openModal(modalEl) {
  modalEl.hidden = false;
  // Un frame pour laisser le navigateur peindre l'état initial avant de
  // déclencher la transition vers .open (sinon pas de transition du tout).
  requestAnimationFrame(() => modalEl.classList.add('open'));
}

function closeModal(modalEl) {
  modalEl.classList.remove('open');
  setTimeout(() => {
    modalEl.hidden = true;
  }, MODAL_CLOSE_TRANSITION_MS);
}

function wireConjunctionsModal() {
  conjunctionsBtn.addEventListener('click', async () => {
    openModal(conjunctionsModal);
    await loadConjunctions();
  });
  conjunctionsClose.addEventListener('click', () => closeModal(conjunctionsModal));
  conjunctionsModal.addEventListener('click', (e) => {
    if (e.target === conjunctionsModal) closeModal(conjunctionsModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !conjunctionsModal.hidden) closeModal(conjunctionsModal);
  });
}

function wireBriefingModal() {
  briefingBtn.addEventListener('click', async () => {
    openModal(briefingModal);
    await loadBriefing();
  });
  briefingClose.addEventListener('click', () => closeModal(briefingModal));
  briefingModal.addEventListener('click', (e) => {
    if (e.target === briefingModal) closeModal(briefingModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !briefingModal.hidden) closeModal(briefingModal);
  });
}

async function loadBriefing() {
  briefingBody.innerHTML = '<p class="hint">Chargement…</p>';
  try {
    const res = await fetch(`${Data.API_BASE}/briefing`);
    if (!res.ok) throw new Error(`Erreur API (${res.status})`);
    const data = await res.json();
    renderBriefing(data.briefing);
  } catch (err) {
    briefingBody.innerHTML = `<p class="hint">Erreur de chargement : ${escapeHtml(err.message)}</p>`;
  }
}

function renderBriefing(briefing) {
  if (!briefing) {
    briefingBody.innerHTML = '<p class="hint">Aucun briefing généré pour l\'instant — le premier sera disponible après le prochain cycle quotidien.</p>';
    return;
  }

  briefingBody.innerHTML = `
    <div class="briefing-content">${renderMarkdownLite(briefing.content)}</div>
    <p id="briefingMeta">Généré le ${new Date(briefing.generated_at).toLocaleString('fr-FR')} · modèle : ${escapeHtml(briefing.model_used)}</p>
  `;
}

// Convertisseur minimal pour le texte généré par le modèle IA (gras, listes
// à puces, paragraphes) — pas un parseur markdown complet, juste ce que le
// prompt du briefing produit réellement. Échappe d'abord tout le texte brut
// (escapeHtml) donc aucune balise du contenu du modèle ne peut s'injecter ;
// seules les balises ajoutées ici (strong/ul/li/p) sont fiables.
function renderMarkdownLite(text) {
  const inlineBold = (line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const isList = lines.every((l) => /^[*-]\s+/.test(l));
      if (isList) {
        const items = lines.map((l) => `<li>${inlineBold(l.replace(/^[*-]\s+/, ''))}</li>`).join('');
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map(inlineBold).join('<br>')}</p>`;
    })
    .join('');
}

async function loadConjunctions() {
  conjunctionsBody.innerHTML = '<p class="hint">Chargement…</p>';
  try {
    const res = await fetch(`${Data.API_BASE}/conjunctions`);
    if (!res.ok) throw new Error(`Erreur API (${res.status})`);
    const data = await res.json();
    renderConjunctions(data.conjunctions);
  } catch (err) {
    conjunctionsBody.innerHTML = `<p class="hint">Erreur de chargement : ${escapeHtml(err.message)}</p>`;
  }
}

function renderConjunctions(conjunctions) {
  if (!conjunctions || conjunctions.length === 0) {
    conjunctionsBody.innerHTML = '<p class="hint">Aucun rapprochement significatif détecté actuellement.</p>';
    return;
  }

  const rows = conjunctions
    .map(
      (c) => `
        <tr>
          <td>${escapeHtml(c.object_a_name ?? String(c.object_a))} (${c.object_a})</td>
          <td>${escapeHtml(c.object_b_name ?? String(c.object_b))} (${c.object_b})</td>
          <td>${new Date(c.tca).toLocaleString('fr-FR')}</td>
          <td>${c.min_distance.toFixed(2)} km</td>
          <td>${c.rel_velocity != null ? c.rel_velocity.toFixed(2) + ' km/s' : '—'}</td>
          <td>${c.tle_age_hours != null ? c.tle_age_hours.toFixed(1) + ' h' : '—'}</td>
        </tr>
      `
    )
    .join('');

  conjunctionsBody.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Objet A</th>
          <th>Objet B</th>
          <th>TCA (rapprochement max.)</th>
          <th>Distance min.</th>
          <th>Vitesse relative</th>
          <th>Âge TLE moyen</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function wireSearchEvents() {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      renderStarterResults();
      return;
    }
    const matches = state.satellites
      .filter((sat) => sat.name.toLowerCase().includes(query) || String(sat.noradId).includes(query))
      .slice(0, MAX_SEARCH_RESULTS);
    renderSearchResults(matches);
  });

  // 'focus' seul ne suffit pas : si le champ est déjà focus (ex. l'utilisateur
  // avait cliqué ailleurs pour fermer la liste sans perdre le focus du champ),
  // un second clic ne redéclenche pas d'événement 'focus' — on écoute donc
  // aussi 'click' pour rouvrir la liste dans ce cas.
  const openStarterIfEmpty = () => {
    if (!searchInput.value.trim() && searchResultsEl.hidden) renderStarterResults();
  };
  searchInput.addEventListener('focus', openStarterIfEmpty);
  searchInput.addEventListener('click', openStarterIfEmpty);

  searchResultsEl.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-norad-id]');
    if (!li) return;
    selectFromSearch(Number.parseInt(li.dataset.noradId, 10));
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSearchResults();
  });

  document.addEventListener('click', (e) => {
    if (!searchBoxEl.contains(e.target)) hideSearchResults();
  });
}

const CATEGORY_LABELS = { stations: 'Station', active: 'Actif', debris: 'Débris' };

// Champ vide (ou juste focus) : pas de requête à filtrer sur 13 000+ objets
// dont la plupart n'ont qu'un numéro de catalogue — on propose plutôt les
// objets à noms reconnaissables (stations) pour que l'utilisateur découvre
// ce qui est disponible avant de taper quoi que ce soit.
function renderStarterResults() {
  const stations = state.satellites
    .filter((sat) => sat.category === 'stations')
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SEARCH_RESULTS);
  renderSearchResults(stations, { hint: 'Stations en orbite — tapez un nom ou un NORAD ID pour chercher parmi tous les objets suivis' });
}

function renderSearchResults(matches, { hint } = {}) {
  const hintHtml = hint ? `<li class="hint-row">${escapeHtml(hint)}</li>` : '';
  if (matches.length === 0) {
    searchResultsEl.innerHTML = `${hintHtml}<li class="empty">Aucun résultat</li>`;
  } else {
    searchResultsEl.innerHTML =
      hintHtml +
      matches
        .map((sat) => {
          const hiddenNote = isVisible(sat)
            ? ''
            : '<span class="hidden-note">objet masqué par vos filtres actuels</span>';
          const categoryLabel = CATEGORY_LABELS[sat.category] ?? '';
          const badge = categoryLabel ? `<span class="category-badge cat-${sat.category}">${categoryLabel}</span>` : '';
          return `<li data-norad-id="${sat.noradId}"><span class="result-name">${badge}${escapeHtml(sat.name)} · ${sat.noradId}</span>${hiddenNote}</li>`;
        })
        .join('');
  }
  searchResultsEl.hidden = false;
}

function hideSearchResults() {
  searchResultsEl.hidden = true;
  searchResultsEl.innerHTML = '';
}

function selectFromSearch(noradId) {
  const sat = state.satellites.find((s) => s.noradId === noradId);
  if (!sat) return;

  state.selectedNoradId = noradId;
  const now = new Date();
  sat.current = Data.propagateGeodetic(sat.satrec, now);
  if (sat.current) {
    Globe.flyTo(sat.current.longitudeDeg, sat.current.latitudeDeg);
  }

  updateDetail(now);
  recomputePasses();

  searchInput.value = '';
  hideSearchResults();
}

function wireObserverEvents() {
  const applyManualPosition = () => {
    const latDeg = Number.parseFloat(obsLatInput.value);
    const lonDeg = Number.parseFloat(obsLonInput.value);
    if (Number.isNaN(latDeg) || Number.isNaN(lonDeg)) {
      state.observer = null;
      obsStatusEl.textContent = '';
      recomputePasses();
      return;
    }
    state.observer = { latDeg, lonDeg };
    obsStatusEl.textContent = '';
    recomputePasses();
  };

  obsLatInput.addEventListener('change', applyManualPosition);
  obsLonInput.addEventListener('change', applyManualPosition);

  obsGeolocateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      obsStatusEl.textContent = "Géolocalisation non disponible sur ce navigateur.";
      return;
    }
    obsStatusEl.textContent = 'Localisation en cours…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latDeg = pos.coords.latitude;
        const lonDeg = pos.coords.longitude;
        obsLatInput.value = latDeg.toFixed(4);
        obsLonInput.value = lonDeg.toFixed(4);
        state.observer = { latDeg, lonDeg };
        obsStatusEl.textContent = '';
        recomputePasses();
      },
      (err) => {
        obsStatusEl.textContent = `Géolocalisation refusée ou indisponible (${err.message}).`;
      },
      { timeout: 10000 }
    );
  });
}

function recomputePasses() {
  const sat = state.satellites.find((s) => s.noradId === state.selectedNoradId);
  if (!state.observer || !sat) {
    passesSectionEl.hidden = true;
    return;
  }

  const passes = Passes.findPasses(sat.satrec, state.observer);
  renderPasses(passes);
}

function renderPasses(passes) {
  passesSectionEl.hidden = false;

  if (passes.length === 0) {
    passesTableBodyEl.innerHTML = '<tr><td colspan="7">Aucun passage sur les 72 prochaines heures.</td></tr>';
    return;
  }

  passesTableBodyEl.innerHTML = passes
    .map(
      (p) => `
        <tr>
          <td>${formatTime(p.riseDate)}</td>
          <td>${p.riseAzimuthDeg.toFixed(0)}°</td>
          <td>${formatTime(p.maxElevationDate)}</td>
          <td>${p.maxElevationDeg.toFixed(1)}°</td>
          <td>${p.maxElevationAzimuthDeg.toFixed(0)}°</td>
          <td>${formatTime(p.setDate)}</td>
          <td>${p.setAzimuthDeg.toFixed(0)}°</td>
        </tr>
      `
    )
    .join('');
}

function formatTime(date) {
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tick() {
  if (state.satellites.length === 0) return;
  const now = new Date();
  const visible = [];

  for (const sat of state.satellites) {
    const visibleNow = isVisible(sat);
    // L'objet sélectionné garde une position à jour même masqué par les
    // filtres (fiche détail + recherche doivent rester utilisables), mais
    // n'est pas ajouté à `visible` donc pas rendu comme point sur le globe.
    if (!visibleNow && sat.noradId !== state.selectedNoradId) {
      sat.current = null;
      continue;
    }
    sat.current = Data.propagateGeodetic(sat.satrec, now);
    if (visibleNow) visible.push(sat);
  }

  Globe.updatePositions(visible, state.selectedNoradId);

  const selected = state.satellites.find((s) => s.noradId === state.selectedNoradId);
  if (selected?.current) {
    Globe.updateGroundTrack(Data.sampleGroundTrack(selected.satrec, now));
  } else {
    Globe.updateGroundTrack([]);
  }

  updateStatus(now, visible.length);
  updateDetail(now);
}

function updateStatus(now, visibleCount) {
  const ages = Object.values(state.fetchedAtByGroup).map((iso) => now - new Date(iso));
  const oldestAgeMs = ages.length > 0 ? Math.max(...ages) : null;
  const ageText = oldestAgeMs !== null ? Data.formatDuration(oldestAgeMs) : '?';
  statusEl.textContent = `${visibleCount}/${state.satellites.length} objets affichés · lot le plus ancien il y a ${ageText} · ${now.toISOString()}`;
}

let lastRenderedNoradId;

function triggerFadeSwap() {
  objectDetailEl.classList.remove('fade-swap');
  // eslint-disable-next-line no-unused-expressions
  objectDetailEl.offsetWidth; // lecture forçant un reflow, pour pouvoir rejouer l'animation
  objectDetailEl.classList.add('fade-swap');
}

function renderStationCard(meta) {
  return `
    <div class="station-card">
      <img class="station-photo" src="${escapeHtml(meta.photo)}" alt="" loading="lazy" />
      <p class="station-description">${escapeHtml(meta.description)}</p>
      <dl class="station-links">
        <dt>Agence</dt><dd>${escapeHtml(meta.agency)}</dd>
      </dl>
      <div class="station-actions">
        <a href="${escapeHtml(meta.site)}" target="_blank" rel="noopener noreferrer">Site officiel ↗</a>
        <a href="${escapeHtml(meta.wikipedia)}" target="_blank" rel="noopener noreferrer">Wikipédia ↗</a>
      </div>
      <p class="station-credit">Photo : ${escapeHtml(meta.photoCredit)}</p>
    </div>
  `;
}

function updateDetail(now) {
  const sat = state.satellites.find((s) => s.noradId === state.selectedNoradId);
  const currentId = sat?.current ? sat.noradId : null;
  const selectionChanged = currentId !== lastRenderedNoradId;
  if (selectionChanged) {
    triggerFadeSwap();
    lastRenderedNoradId = currentId;
  }

  if (!sat?.current) {
    objectDetailEl.innerHTML = '<p class="hint">Clique sur un objet pour afficher sa fiche.</p>';
    return;
  }

  // Ne reconstruit le squelette (dont la photo <img>) que lors d'un changement
  // de sélection — un innerHTML rebuild à chaque tick (1s) interromprait
  // indéfiniment le chargement de l'image avant qu'elle n'ait le temps d'arriver.
  if (selectionChanged) {
    const meta = getStationMetadata(sat.name);
    objectDetailEl.innerHTML = `
      <h2><span class="selection-dot"></span>${escapeHtml(sat.name)}</h2>
      ${meta ? renderStationCard(meta) : ''}
      <dl>
        <dt>NORAD ID</dt><dd>${sat.noradId}</dd>
        <dt>Désignation intl.</dt><dd>${sat.intlDesignator}</dd>
        ${sat.originEvent ? `<dt>Événement d'origine</dt><dd>${escapeHtml(sat.originEvent)}</dd>` : ''}
        <dt>Latitude</dt><dd data-field="lat"></dd>
        <dt>Longitude</dt><dd data-field="lon"></dd>
        <dt>Altitude</dt><dd data-field="alt"></dd>
        <dt>Inclinaison</dt><dd data-field="incl"></dd>
        <dt>Période orbitale</dt><dd data-field="period"></dd>
        <dt>Époque du TLE</dt><dd data-field="epoch"></dd>
        <dt>Âge du TLE</dt><dd data-field="age"></dd>
      </dl>
      <p class="warn">Position calculée par propagation SGP4 à partir d'un TLE public. Précision de l'ordre du km, se dégrade avec l'âge du TLE — ne pas utiliser pour une décision opérationnelle.</p>
    `;
  }

  const periodMin = Data.orbitalPeriodMinutes(sat.satrec);
  const incl = Data.inclinationDeg(sat.satrec);
  const tleAgeMs = now - sat.epochDate;

  objectDetailEl.querySelector('[data-field="lat"]').textContent = `${sat.current.latitudeDeg.toFixed(3)}°`;
  objectDetailEl.querySelector('[data-field="lon"]').textContent = `${sat.current.longitudeDeg.toFixed(3)}°`;
  objectDetailEl.querySelector('[data-field="alt"]').textContent = `${sat.current.altitudeKm.toFixed(1)} km`;
  objectDetailEl.querySelector('[data-field="incl"]').textContent = `${incl.toFixed(2)}°`;
  objectDetailEl.querySelector('[data-field="period"]').textContent = `${periodMin.toFixed(1)} min`;
  objectDetailEl.querySelector('[data-field="epoch"]').textContent = sat.epochDate.toISOString();
  objectDetailEl.querySelector('[data-field="age"]').textContent = Data.formatDuration(tleAgeMs);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
