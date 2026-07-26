# Orbital Watch — Architecture technique

> Document de cadrage destiné à être fourni à Claude Code (Fable 5) comme
> contexte de départ. Objectif : éviter les allers-retours coûteux en crédits
> en fixant l'architecture, les sources de données et le périmètre AVANT
> d'écrire la première ligne de code.

**Auteur** : Djelloul ABID
**Date** : 20 juillet 2026
**Statut** : Cadrage — non implémenté

---

## 1. Le projet en une phrase

Un tableau de bord web qui suit en temps réel les satellites actifs et les
débris spatiaux en orbite terrestre, visualise leurs trajectoires, et signale
les rapprochements à risque entre objets.

## 2. Positionnement — ce qui existe déjà

Il faut être lucide : ce domaine est occupé.

| Acteur | Ce qu'ils font | Public |
|---|---|---|
| Space-Track.org (USSPACECOM) | Source officielle des données orbitales et des alertes de conjonction | Opérateurs satellites |
| CelesTrak (Dr. T.S. Kelso) | Catalogue TLE de référence, outils d'analyse | Communauté technique |
| LeoLabs | Radars commerciaux, suivi de débris haute précision | Industrie (payant) |
| ESA Space Debris Office | Rapports annuels, modélisation | Institutionnel |
| Stuff in Space | Visualisation 3D grand public du catalogue | Grand public |

**Conclusion** : ne pas chercher à concurrencer la précision de LeoLabs ni
l'exhaustivité de Space-Track. L'angle différenciant réalisable est
**la lisibilité et la narration** : rendre compréhensible à un public
non-spécialiste ce que ces données brutes racontent, avec une couche
d'interprétation IA.

C'est aussi cohérent avec le positionnement de DigitalBlueSkye : un
laboratoire personnel qui documente et vulgarise.

## 3. Sources de données

### 3.1 Données orbitales (obligatoire)

**CelesTrak** — <https://celestrak.org/NORAD/elements/gp.php>

- Format : TLE (Two-Line Element) ou JSON
- Pas d'authentification requise
- Groupes utiles : `active`, `stations`, `starlink`, `cosmos-1408-debris`,
  `fengyun-1c-debris`, `iridium-33-debris`, `cosmos-2251-debris`
- **Contrainte** : CelesTrak demande explicitement de ne pas interroger plus
  d'une fois toutes les 2 heures par groupe. Le cache est obligatoire, pas
  optionnel.

**Space-Track.org** (optionnel, phase 2)

- Compte gratuit requis, authentification par session
- Seule source des CDM (Conjunction Data Messages) — les vraies alertes de
  collision calculées par l'USSPACECOM
- Conditions d'utilisation strictes : lire l'API usage policy avant intégration

### 3.2 Calcul de position

Les TLE ne donnent pas une position, ils donnent des paramètres orbitaux à un
instant de référence. Il faut les propager avec le modèle **SGP4**.

- Bibliothèque : `satellite.js` (implémentation JS de référence de SGP4/SDP4)
- Entrée : TLE + timestamp → Sortie : position ECI → conversion en
  latitude / longitude / altitude
- Précision : de l'ordre du kilomètre pour un TLE frais, se dégrade
  rapidement au-delà de quelques jours. **Toujours afficher l'âge du TLE.**

## 4. Périmètre fonctionnel

### Module A — Carte temps réel

Visualisation 2D (projection équirectangulaire) ou 3D (globe) des objets
suivis, positions recalculées côté client toutes les secondes.

- Filtres : satellites actifs / débris / stations spatiales / constellation
- Clic sur un objet → fiche détail (NORAD ID, altitude, inclinaison,
  période orbitale, date de lancement, âge du TLE)
- Trace au sol (ground track) sur ±1 orbite

**Décision technique importante** : la propagation SGP4 se fait **côté
client**, pas côté serveur. Le serveur ne sert que des TLE mis en cache. Cela
évite de recalculer N positions × M utilisateurs sur le Worker, et reste dans
les limites du free tier Cloudflare.

### Module B — Prédiction de passages

Pour une position géographique donnée, calculer les prochains passages
visibles d'un objet sélectionné.

- Entrée : lat/lon observateur + objet + fenêtre temporelle
- Sortie : heure de lever, culmination (élévation max), coucher, azimuts
- Filtrage optionnel : passages visibles à l'œil nu (satellite éclairé,
  observateur dans l'ombre)

### Module C — Analyse de rapprochement (le cœur du projet)

**Avertissement sur la rigueur** : ce module ne produit PAS des alertes de
collision au sens opérationnel. Les vraies analyses de conjonction utilisent
des données de suivi haute précision et des matrices de covariance que les TLE
publics ne contiennent pas. Le résultat doit être présenté comme un
**indicateur de rapprochement géométrique**, jamais comme une prédiction de
collision.

Approche en deux temps (méthode standard de conjunction screening) :

1. **Filtrage grossier** — élimination rapide des paires qui ne peuvent
   pas se rapprocher : comparaison des altitudes de périgée/apogée, filtre
   sur la géométrie orbitale. Réduit N² paires à un sous-ensemble traitable.
2. **Calcul fin** — sur les paires survivantes, propagation pas à pas sur la
   fenêtre temporelle pour trouver la distance minimale d'approche (TCA :
   Time of Closest Approach).

Sortie : liste des rapprochements sous un seuil (ex. 5 km) sur les 72h à venir,
avec distance minimale et horodatage.

**Coût de calcul** : c'est la partie lourde. À faire dans un job planifié
(Cloudflare Cron Trigger), résultats stockés en base, jamais calculé à la
volée sur requête utilisateur.

### Module D — Couche narrative IA

C'est le module qui différencie le projet et qui réutilise l'infrastructure
existante de DigitalBlueSkye.

- Génération d'un briefing quotidien en langage naturel à partir des données
  de la journée : événements notables, rapprochements marquants, nouveaux
  objets catalogués
- Fiches explicatives contextuelles : cliquer sur un débris issu de
  Cosmos-1408 → l'IA explique l'événement de 2021 et ses conséquences
- Interrogation en langage naturel : « quels débris passent au-dessus de
  Paris cette nuit ? » → traduction en requête structurée

**Réutilisation** : le `modelRouter.js` existant gère déjà le routage
multi-fournisseur avec tiers fast/balanced/strong. Le briefing quotidien peut
tourner en tier `fast` (peu coûteux), les explications contextuelles en
`balanced`.

## 5. Stack technique

Choix guidé par un principe : **réutiliser ce que tu maîtrises déjà et ce qui
est déjà déployé**, pour que les crédits Fable 5 servent à la logique métier,
pas à réapprendre une stack.

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (statique, hébergé Netlify/Cloudflare Pages)  │
│                                                          │
│  HTML/CSS/JS vanilla — cohérent avec DigitalBlueSkye    │
│  ├── satellite.js      → propagation SGP4 client        │
│  ├── CesiumJS ou D3    → rendu globe 3D / carte 2D      │
│  └── Chart.js          → graphes altitude, densité      │
└────────────────────────┬────────────────────────────────┘
                         │ fetch JSON
┌────────────────────────▼────────────────────────────────┐
│  CLOUDFLARE WORKER — orbital-api                        │
│                                                          │
│  GET  /tle/:group      → TLE en cache (KV)              │
│  GET  /object/:noradId → métadonnées d'un objet         │
│  GET  /conjunctions    → rapprochements précalculés     │
│  POST /ask             → question NL → réponse IA       │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
┌──────▼────────┐         ┌───────▼──────────┐
│ KV            │         │ D1 (SQLite)      │
│ Cache TLE     │         │ Catalogue objets │
│ TTL 2h        │         │ Historique       │
│               │         │ Conjonctions     │
└───────────────┘         └──────────────────┘
       ▲
┌──────┴──────────────────────────────────────┐
│  CRON TRIGGER (Worker planifié)             │
│                                              │
│  */2h  → refresh TLE depuis CelesTrak       │
│  1/jour → screening de conjonction          │
│  1/jour → génération briefing IA            │
└─────────────────────────────────────────────┘
```

### Schéma de base D1

```sql
-- Catalogue des objets suivis
CREATE TABLE objects (
  norad_id      INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  object_type   TEXT,              -- PAYLOAD | ROCKET BODY | DEBRIS
  country       TEXT,
  launch_date   TEXT,
  origin_event  TEXT,              -- ex: 'COSMOS-1408 ASAT 2021'
  tle_line1     TEXT NOT NULL,
  tle_line2     TEXT NOT NULL,
  tle_epoch     TEXT NOT NULL,     -- pour afficher la fraîcheur
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_objects_type ON objects(object_type);
CREATE INDEX idx_objects_event ON objects(origin_event);

-- Rapprochements détectés par le job de screening
CREATE TABLE conjunctions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  object_a      INTEGER NOT NULL REFERENCES objects(norad_id),
  object_b      INTEGER NOT NULL REFERENCES objects(norad_id),
  tca           TEXT NOT NULL,     -- Time of Closest Approach (ISO 8601)
  min_distance  REAL NOT NULL,     -- km
  rel_velocity  REAL,              -- km/s
  computed_at   TEXT NOT NULL,
  tle_age_hours REAL               -- fiabilité du calcul
);

CREATE INDEX idx_conj_tca ON conjunctions(tca);

-- Briefings générés par l'IA
CREATE TABLE briefings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL UNIQUE,
  content       TEXT NOT NULL,
  model_used    TEXT,
  generated_at  TEXT NOT NULL
);
```

## 6. Découpage en phases

Chaque phase est livrable et testable indépendamment. **Ne pas lancer la phase
suivante avant que la précédente ne fonctionne** — c'est la règle qui protège
le budget crédits.

### Phase 1 — Socle données (≈ 2 jours)

- [ ] Worker `orbital-api` avec route `GET /tle/:group`
- [ ] Récupération CelesTrak + cache KV avec TTL 2h
- [ ] Schéma D1 créé et peuplé pour un groupe (`stations` — seulement
      quelques objets, idéal pour tester)
- [ ] Cron trigger de rafraîchissement
- [ ] **Critère de sortie** : `curl` sur l'endpoint renvoie des TLE valides,
      le cache fonctionne, le cron tourne

### Phase 2 — Visualisation (≈ 3 jours)

- [ ] Page statique avec carte 2D
- [ ] Intégration satellite.js, propagation client
- [ ] Affichage ISS + stations, rafraîchissement 1 Hz
- [ ] Fiche détail au clic
- [ ] Trace au sol
- [ ] **Critère de sortie** : l'ISS est au bon endroit (vérifier contre
      n2yo.com ou l'app officielle NASA)

### Phase 3 — Montée en volume (≈ 2 jours)

- [ ] Extension aux groupes `active` + groupes de débris
- [ ] Filtres par type / événement d'origine
- [ ] Optimisation du rendu (plusieurs milliers d'objets → WebGL ou canvas,
      pas de DOM par objet)
- [ ] **Critère de sortie** : 5000+ objets affichés sans chute de framerate

### Phase 4 — Passages (≈ 2 jours)

- [ ] Géolocalisation ou saisie manuelle de la position observateur
- [ ] Calcul des passages à venir
- [ ] Tableau des prochains passages avec élévation max

### Phase 5 — Conjonctions (≈ 4 jours, la plus difficile)

- [ ] Algorithme de filtrage grossier
- [ ] Calcul fin du TCA sur paires retenues
- [ ] Job cron quotidien, écriture en D1
- [ ] Page listant les rapprochements à venir
- [ ] **Avertissements explicites dans l'UI** sur la nature indicative
- [ ] **Critère de sortie** : le job tourne sous la limite CPU du Worker
      (attention : plan gratuit = 10 ms CPU par invocation, il faudra
      probablement découper en plusieurs invocations ou passer par
      Durable Objects / Queues)

### Phase 6 — Couche IA (≈ 2 jours)

- [ ] Réutilisation de `modelRouter.js`
- [ ] Génération du briefing quotidien (cron)
- [ ] Endpoint `/ask` avec traduction NL → requête
- [ ] Fiches contextuelles sur les événements de fragmentation

## 7. Stratégie budget crédits

C'est la section la plus importante compte tenu de ta contrainte ($85).

**Répartition des tâches par modèle** :

| Type de tâche | Modèle | Pourquoi |
|---|---|---|
| Architecture, algorithme de conjonction, debug complexe | Fable 5 | Raisonnement nécessaire |
| Écriture de code sur spec claire | Sonnet | Rapport qualité/prix |
| Boilerplate, CSS, corrections mineures | Haiku | 10× moins cher |

**Règles opérationnelles** :

1. **Une phase = une session Claude Code.** Ne pas garder un contexte de 200k
   tokens sur plusieurs jours : chaque message renvoie tout l'historique et le
   coût grimpe de façon quadratique.
2. **Utiliser `/compact`** dès que le contexte dépasse ~50%.
3. **Écrire les specs à la main** (ou avec un modèle bon marché) avant de
   lancer Fable 5. Fable 5 doit coder, pas deviner.
4. **Ne jamais laisser l'agent explorer le repo à l'aveugle.** Pointer les
   fichiers avec `@`. Une lecture de dossier complet, c'est 50k tokens gaspillés.
5. **Tester manuellement entre chaque phase.** Un bug découvert 3 phases plus
   tard coûte bien plus cher à corriger.

**Estimation** : Phases 1-4 sont faisables avec Sonnet à ~$15-25. Garder Fable 5
pour la phase 5 (l'algorithme de conjonction) où le raisonnement compte
vraiment.

## 8. Pièges identifiés

| Piège | Conséquence | Parade |
|---|---|---|
| Propager 20 000 objets côté serveur | Explosion CPU, dépassement free tier | Propagation client uniquement |
| Interroger CelesTrak à chaque requête | Bannissement IP | Cache KV 2h, non négociable |
| Présenter les rapprochements comme des alertes de collision | Désinformation, crédibilité détruite | Avertissements explicites dans l'UI |
| Screening N² sur le catalogue complet | 20 000² = 400M paires, intenable | Filtrage grossier obligatoire en amont |
| Ignorer l'âge des TLE | Positions fausses de plusieurs km sans le signaler | Afficher `tle_epoch` partout |
| Créer une seconde base / infra | Coût et complexité en double | Réutiliser D1 `digitalblueskye` |

## 9. Prompt de démarrage pour Claude Code

À utiliser tel quel pour lancer la phase 1 :

> Je démarre un projet appelé Orbital Watch. L'architecture complète est dans
> `@ORBITAL-WATCH-ARCHITECTURE.md` — lis-le d'abord.
>
> On attaque **uniquement la phase 1** (socle données). Ne code rien des autres
> phases.
>
> Contexte technique : je réutilise mon infra Cloudflare existante. Regarde
> `@cloudflare/wrangler.api.toml` pour le style de configuration et la base D1
> déjà en place.
>
> Livrables attendus :
> 1. Un nouveau Worker `orbital-api` avec sa config wrangler
> 2. La route `GET /tle/:group` qui sert les TLE CelesTrak avec cache KV (TTL 2h)
> 3. Les migrations SQL pour les tables `objects`, `conjunctions`, `briefings`
> 4. Un cron trigger de rafraîchissement toutes les 2h
>
> Commence par me proposer le plan de fichiers avant d'écrire du code.

---

## Annexe — Ressources

- CelesTrak : <https://celestrak.org/>
- Space-Track : <https://www.space-track.org/>
- satellite.js : <https://github.com/shashwatak/satellite-js>
- Documentation SGP4 (papier de référence) : Vallado, *Revisiting Spacetrack
  Report #3*
- ESA Space Environment Report (statistiques annuelles sur les débris)
- Cloudflare Workers limits : <https://developers.cloudflare.com/workers/platform/limits/>
