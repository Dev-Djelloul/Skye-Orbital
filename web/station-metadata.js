// Fiches enrichies pour les objets du groupe "stations" — CelesTrak liste 23
// objets sous ce groupe (modules de station + véhicules amarrés + quelques
// cubesats déployés à proximité), pas 23 "stations" au sens propre : il n'y a
// en réalité que deux stations habitées (ISS, CSS/Tiangong). Les entrées
// ci-dessous couvrent les objets identifiables avec une photo + une source
// fiable ; tout objet absent de cette table retombe sur la fiche standard.
//
// Photos : Wikimedia Commons (licences libres), URLs vérifiées manuellement.
// Logos d'agences : fournis par l'utilisateur (assets/Icons/) pour NASA, ESA,
// JAXA, CSA, Roscosmos, SpaceX et CMSA (Chine) ; complété depuis Wikimedia
// Commons pour Northrop Grumman (seule agence sans asset fourni).

const AGENCIES = {
  nasa: { name: 'NASA', icon: 'assets/agencies/nasa.png', url: 'https://www.nasa.gov/' },
  esa: { name: 'ESA', icon: 'assets/agencies/esa.png', url: 'https://www.esa.int/' },
  jaxa: { name: 'JAXA', icon: 'assets/agencies/jaxa.png', url: 'https://global.jaxa.jp/' },
  csa: {
    name: 'ASC/CSA',
    icon: 'assets/agencies/csa.png',
    url: 'https://www.asc-csa.gc.ca/',
  },
  // roscosmos.ru renvoie une 403 depuis de nombreux réseaux occidentaux (blocage
  // géographique confirmé) — le badge pointe vers Wikipédia plutôt qu'un lien mort.
  roscosmos: {
    name: 'Roscosmos',
    icon: 'assets/agencies/roscosmos.png',
    url: 'https://fr.wikipedia.org/wiki/Roscosmos',
  },
  spacex: { name: 'SpaceX', icon: 'assets/agencies/spacex.png', url: 'https://www.spacex.com/' },
  northropGrumman: {
    name: 'Northrop Grumman',
    icon: 'assets/agencies/northrop-grumman.png',
    url: 'https://www.northropgrumman.com/space/cygnus-spacecraft/',
  },
  cmsa: {
    name: 'CMSA (Chine)',
    icon: 'assets/agencies/cmsa.png',
    url: 'http://www.cmse.gov.cn/',
  },
};

const ISS = {
  agencies: [AGENCIES.nasa, AGENCIES.roscosmos, AGENCIES.esa, AGENCIES.jaxa, AGENCIES.csa],
  site: 'https://www.nasa.gov/reference/international-space-station/',
  virtualTour: 'https://www.nasa.gov/feature/iss-virtual-tour/',
  wikipedia: 'https://fr.wikipedia.org/wiki/Station_spatiale_internationale',
  photo:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/STS-134_International_Space_Station_after_undocking.jpg/960px-STS-134_International_Space_Station_after_undocking.jpg',
  photoCredit: 'NASA — Wikimedia Commons',
  description:
    "Station spatiale internationale, en orbite depuis 1998. Coopération entre les agences spatiales américaine, russe, européenne, japonaise et canadienne. ZARYA, POISK et NAUKA sont trois modules de cette même station, pas des stations distinctes — POISK sert notamment de port d'amarrage pour les vaisseaux russes (Soyouz, Progress).",
};

const CSS = {
  agencies: [AGENCIES.cmsa],
  wikipedia: 'https://fr.wikipedia.org/wiki/Station_spatiale_chinoise',
  photo:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Chinese_Tiangong_Space_Station.jpg/960px-Chinese_Tiangong_Space_Station.jpg',
  photoCredit: 'CMSA / Shujianyang — Wikimedia Commons',
  description:
    'Station spatiale chinoise Tiangong ("Palais céleste"), assemblée en orbite entre 2021 et 2022, exploitée par la CMSA (Agence spatiale habitée chinoise).',
};

export const STATION_METADATA = {
  // ISS et ses modules
  'ISS (ZARYA)': ISS,
  POISK: ISS,
  'ISS (NAUKA)': ISS,

  // CSS / Tiangong et ses modules
  'CSS (TIANHE)': CSS,
  'CSS (WENTIAN)': CSS,
  'CSS (MENGTIAN)': CSS,

  // Véhicules amarrés / visiteurs — fiche propre, pas confondue avec la station hôte
  'SOYUZ-MS 28': {
    agencies: [AGENCIES.roscosmos],
    wikipedia: 'https://fr.wikipedia.org/wiki/Soyouz_(vaisseau_spatial)',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/Soyuz_TMA-16_approaching_ISS.jpg/960px-Soyuz_TMA-16_approaching_ISS.jpg',
    photoCredit: 'NASA — Wikimedia Commons',
    description: "Vaisseau russe habité, amarré à l'ISS pour la relève d'équipage.",
  },
  'CREW DRAGON 12': {
    agencies: [AGENCIES.spacex],
    site: 'https://www.spacex.com/vehicles/dragon/',
    wikipedia: 'https://fr.wikipedia.org/wiki/SpaceX_Crew-12',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/SpaceX_Crew_Dragon.jpg/960px-SpaceX_Crew_Dragon.jpg',
    photoCredit: 'SpaceX — Wikimedia Commons',
    description: "Capsule habitée commerciale de SpaceX, amarrée à l'ISS dans le cadre du programme Commercial Crew de la NASA.",
  },
  'CYGNUS NG-24': {
    agencies: [AGENCIES.northropGrumman],
    site: 'https://www.northropgrumman.com/space/cygnus-spacecraft/',
    wikipedia: 'https://fr.wikipedia.org/wiki/Cygnus_(v%C3%A9hicule_spatial)',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/ISS-45_Cygnus_5_approaching_the_ISS_%281%29.jpg/960px-ISS-45_Cygnus_5_approaching_the_ISS_%281%29.jpg',
    photoCredit: 'NASA — Wikimedia Commons',
    description: "Cargo automatique ravitaillant l'ISS, développé par Northrop Grumman pour la NASA.",
  },
  'PROGRESS-MS 33': {
    agencies: [AGENCIES.roscosmos],
    wikipedia: 'https://fr.wikipedia.org/wiki/Progress',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/ISS_Progress_cargo_spacecraft.jpg/960px-ISS_Progress_cargo_spacecraft.jpg',
    photoCredit: 'NASA — Wikimedia Commons',
    description: "Cargo automatique russe ravitaillant l'ISS.",
  },
  'PROGRESS-MS 34': {
    agencies: [AGENCIES.roscosmos],
    wikipedia: 'https://fr.wikipedia.org/wiki/Progress',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/ISS_Progress_cargo_spacecraft.jpg/960px-ISS_Progress_cargo_spacecraft.jpg',
    photoCredit: 'NASA — Wikimedia Commons',
    description: "Cargo automatique russe ravitaillant l'ISS.",
  },
  'TIANZHOU-10': {
    agencies: [AGENCIES.cmsa],
    wikipedia: 'https://fr.wikipedia.org/wiki/Tianzhou_(v%C3%A9hicule_spatial)',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/Chinese_Tiangong_Space_Station.jpg/960px-Chinese_Tiangong_Space_Station.jpg',
    photoCredit: 'CMSA / Shujianyang — Wikimedia Commons',
    description: 'Cargo automatique chinois ravitaillant la station Tiangong.',
  },
  'SHENZHOU-23 (SZ-23)': {
    agencies: [AGENCIES.cmsa],
    wikipedia: 'https://fr.wikipedia.org/wiki/Programme_Shenzhou',
    photo:
      'https://upload.wikimedia.org/wikipedia/commons/8/8c/Shenzhou_spacecraft_ground_test.png',
    photoCredit: 'CMSA — Wikimedia Commons',
    description: 'Vaisseau habité chinois, amarré à la station Tiangong pour la relève d\'équipage.',
  },
};

export function getStationMetadata(name) {
  return STATION_METADATA[name] ?? null;
}
