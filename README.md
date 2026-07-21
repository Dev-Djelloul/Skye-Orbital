# 🛰️ Skye Orbital

Un tableau de bord temps réel qui visualise les satellites actifs et les débris spatiaux en orbite terrestre basse, sur un globe 3D, avec prédiction des passages et détection des rapprochements orbitaux.

> Projet personnel de Djelloul ABID — laboratoire d’expérimentation autour du web, des données ouvertes et de l’IA, dans la continuité de DigitalBlueSkye.
> 

---

## En bref

Skye Orbital récupère les éléments orbitaux publics de milliers de satellites et débris, calcule leur position en temps réel directement dans le navigateur, et les affiche sur un globe 3D interactif. Le projet permet de :

- **Voir** où se trouve n’importe quel satellite suivi, à l’instant présent
- **Prédire** les prochains passages visibles d’un objet au-dessus d’une position donnée
- **Repérer** les rapprochements orbitaux entre satellites actifs et débris

Ce n’est pas un outil de suivi opérationnel — les calculs reposent sur des données publiques (TLE) dont la précision se dégrade avec le temps. C’est un outil de vulgarisation et d’exploration, pensé pour rendre lisible ce qui, sinon, reste un tableau de coordonnées abstrait.

## Pourquoi ce projet

Le domaine du suivi orbital est déjà occupé par des acteurs sérieux : Space-Track (USSPACECOM), CelesTrak, LeoLabs pour la précision opérationnelle. Skye Orbital ne cherche pas à les concurrencer. L’angle est différent : rendre ces données compréhensibles à un public non spécialiste, avec une interface soignée et, à terme, une couche narrative générée par IA pour expliquer ce qu’on regarde.

## Aperçu

Le globe affiche les objets suivis en 3D, avec sélection au clic, fiche technique détaillée (altitude, inclinaison, période orbitale, âge du TLE), trace au sol, et recherche par nom ou identifiant NORAD.

*(Captures d’écran à ajouter — globe avec la coquille Starlink, fiche détail de l’ISS, tableau des prochains passages.)*

## Fonctionnalités

### ✅ Suivi en temps réel

Position calculée côté client par propagation SGP4 (via `satellite.js`) à partir des éléments orbitaux (TLE) publiés par CelesTrak, rafraîchie chaque seconde. Plus de 13 000 objets simultanés (Starlink, débris de fragmentation, stations spatiales), rendus en WebGL via CesiumJS pour rester fluide à cette échelle.

### ✅ Globe 3D interactif

Terre texturée (imagerie Natural Earth II), rotation automatique, trace au sol suivant la courbure du globe, sélection au clic avec fiche détail complète.

### ✅ Filtres et recherche

Filtrage par catégorie (actifs, stations, débris) et par événement d’origine pour les débris (destruction ASAT de Cosmos-1408 en 2021, de Fengyun-1C en 2007, collision Iridium-33/Cosmos-2251 en 2009). Recherche instantanée par nom ou NORAD ID.

### ✅ Prédiction de passages

Pour une position d’observateur donnée (géolocalisation ou saisie manuelle), calcul des prochains passages d’un objet sélectionné : heure de lever, culmination (élévation maximale), coucher, avec azimuts.

### 🚧 Détection de rapprochements orbitaux (en cours)

Repérage des paires d’objets dont la distance minimale d’approche passe sous un seuil donné, sur une fenêtre de 72h. **Ceci reste un indicateur géométrique indicatif basé sur des données publiques, pas une prédiction de collision opérationnelle** — les vraies analyses de conjonction nécessitent des données de suivi haute précision (matrices de covariance) que les TLE publics ne contiennent pas.

### 📋 Prévu

Génération de briefings quotidiens en langage naturel et de fiches contextuelles sur les événements de fragmentation, via IA.

## Stack technique

```
Frontend (statique)
├── HTML / CSS / JS vanilla
├── CesiumJS — rendu du globe 3D (PointPrimitiveCollection / LabelCollection
│   pour tenir la charge à plusieurs milliers d'objets)
└── satellite.js — propagation orbitale SGP4, calcul de passages

Backend (Cloudflare)
├── Workers — API de service (cache TLE, endpoints)
├── D1 (SQLite) — catalogue d'objets, rapprochements, briefings
├── KV — cache des éléments orbitaux (TTL 2h, respect du rate-limit CelesTrak)
└── Cron Triggers — rafraîchissement périodique des données

Source de données
└── CelesTrak (celestrak.org) — éléments orbitaux publics (format TLE/JSON)
```

Aucune dépendance lourde côté client au-delà de Cesium et satellite.js — pas de framework, pas de bundler. La propagation SGP4 tourne entièrement dans le navigateur ; le serveur ne fait que mettre en cache et servir les TLE bruts.

## Statut du projet

| Phase | Description | Statut |
| --- | --- | --- |
| 1 | Socle de données (Worker, cache, cron) | ✅ Terminé |
| 2 | Visualisation de base | ✅ Terminé |
| 3 | Montée en volume (13 000+ objets) | ✅ Terminé |
| 4 | Prédiction de passages | ✅ Terminé |
| 5 | Détection de rapprochements orbitaux | 🚧 En cours |
| 6 | Couche narrative IA | 📋 Prévu |

## Lancer le projet en local

```bash
# Cloner le dépôt
git clone https://github.com/Dev-Djelloul/skye-orbital.git
cd skye-orbital

# Servir le frontend statique
cd web
python3 -m http.server 8080
# ou : npx serve .

# Ouvrir
open http://localhost:8080
```

Le frontend pointe vers l’API Cloudflare Worker déployée en production. Pour faire tourner le backend en local, voir la documentation Wrangler (`wrangler dev`) — nécessite un compte Cloudflare avec D1 et KV configurés.

## Avertissement

Les positions affichées sont calculées par propagation SGP4 à partir de TLE publics. Précision de l’ordre du kilomètre, qui se dégrade avec l’âge des données. **Aucune information de ce dashboard ne doit être utilisée pour une décision opérationnelle** (planification de manœuvre, évaluation de risque de collision réelle, etc.). Pour ces usages, se référer aux sources officielles : Space-Track.org, CelesTrak, ou directement aux opérateurs de satellites.

## Sources et remerciements

- CelesTrak — catalogue TLE
- satellite.js — implémentation SGP4/SDP4
- CesiumJS — moteur de rendu 3D
- Space-Track.org — USSPACECOM

## Licence

À définir.

---

*Développé avec Claude Code, dans le cadre d’un apprentissage progressif du développement assisté par IA — projet compagnon de DigitalBlueSkye.