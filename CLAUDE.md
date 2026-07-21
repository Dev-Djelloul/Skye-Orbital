# Sky Orbital

Tableau de bord temps réel de suivi de satellites et débris spatiaux (globe 3D
CesiumJS), avec prédiction de passages, détection de rapprochements orbitaux
et briefing quotidien généré par IA. Cadrage complet dans
`ORBITAL-WATCH-ARCHITECTURE.md` (nom de code historique "Orbital Watch" — le
produit s'appelle désormais **Sky Orbital**, cf. `README.md`).

Développé par phases successives avec Claude Code, budget crédits limité —
chaque phase a été testée avant de passer à la suivante. Les 6 phases prévues
sont terminées ; une phase d'habillage visuel supplémentaire vient d'être
codée (voir "État actuel" en bas de ce fichier — **vérification visuelle non
faite**, c'est la priorité immédiate).

## Stack

- **Frontend** (`web/`) : HTML/CSS/JS vanilla, aucun bundler. CesiumJS (rendu
  globe 3D, chargé en CDN) + satellite.js (propagation SGP4, calcul de
  passages) chargés en CDN avec intégrité SRI. Servi en local via
  `python3 -m http.server 8080` depuis `web/`.
- **Backend** : Cloudflare Worker unique `orbital-api` (fichier
  `orbital-api.js`, config `wrangler.orbital.toml`). D1 (SQLite) pour le
  stockage, KV pour le cache TLE + les données intermédiaires du pipeline de
  conjonctions, Queues pour le découpage du screening de conjonctions, Workers
  AI pour le briefing quotidien.
- **Source de données** : CelesTrak (`celestrak.org`) — TLE publics. **Ne
  jamais interroger plus d'une fois toutes les 2h par groupe** (politique
  explicite de CelesTrak, déjà eu des 522/throttling en la testant trop vite).

## Ressources Cloudflare déployées (compte du propriétaire du projet)

- Worker : `orbital-api` — `https://orbital-api.djelloulabid75.workers.dev`
- D1 : `digitalblueskye` (partagée avec d'autres projets du même compte —
  tables `objects`, `conjunctions`, `briefings`, `conjunction_runs` +
  beaucoup d'autres tables non liées à Sky Orbital, ne pas y toucher)
- KV : `TLE_CACHE` (cache TLE, TTL 2h) et `CONJ_KV` (données intermédiaires du
  pipeline de conjonctions, par `run_id`)
- Queue : `orbital-conjunctions` + DLQ `orbital-conjunctions-dlq`
  (`max_batch_size: 1` — le budget CPU de chaque étape est dimensionné pour
  UN message par invocation, ne pas relever ce paramètre sans revoir les
  tailles de lot dans `conjunctions.js`)
- Cron : `0 */2 * * *` (rafraîchissement TLE), `0 3 * * *` (kickoff
  conjonctions), `30 3 * * *` (briefing quotidien)
- Workers AI : binding `AI`, utilisé uniquement en tier `fast`
  (`@cf/meta/llama-3.2-3b-instruct`, gratuit). Pas de clé OpenRouter/OpenAI
  configurée pour l'instant — le tier `balanced` (fiches contextuelles,
  reporté) ne fonctionnera pas tant qu'elles ne sont pas ajoutées.

## Fichiers clés

```
orbital-api.js              Worker : routes HTTP, dispatch cron, dispatch queue
conjunctions.js             Algorithme pur de screening (testable en Node, sans Cloudflare)
conjunctions-pipeline.js    Orchestration Cloudflare du pipeline de conjonctions (KV/D1/Queue)
briefing.js                 Génération du briefing quotidien (collecte données + prompt + repli sans IA)
ai/modelRouter.js           Copie vendorisée depuis Devspace/Digitalblueskye/cloudflare/ — PAS de lien live,
ai/completionGuard.js       resynchroniser à la main si l'original évolue
migrations/*.sql            Migrations D1, dans l'ordre numéroté
wrangler.orbital.toml       Config Worker (bindings, cron, queues)

web/index.html              Page unique
web/style.css               Palette/typo/glassmorphism (redesign "Sky Orbital" — cf. état actuel)
web/data.js                 Fetch TLE + parsing + propagation SGP4 (logique pure)
web/globe.js                Rendu Cesium : primitives, picking, caméra, skybox procédural
web/passes.js                Calcul des passages (lever/culmination/coucher)
web/app.js                  Orchestration frontend : état, filtres, recherche, modals
```

## Statut des phases (toutes terminées)

1. Socle données — Worker + KV + cron + D1 `objects`
2. Visualisation — carte 2D puis remplacée par globe 3D CesiumJS (voir phase suivante)
3. Montée en volume — 13 400+ objets (stations + starlink + 4 groupes de débris), filtres
4. Prédiction de passages
5. Détection de rapprochements orbitaux — pipeline Queue en 4 étapes (parse → bin-and-dispatch →
   precompute → scan → refine), seuil de production **5 km**, testé avec un contrôle positif à 50 km
   (200 rapprochements distincts trouvés, seuil restauré ensuite)
6. Couche narrative IA — briefing quotidien (tier `fast`, Workers AI). Fiches contextuelles et
   recherche en langage naturel **reportées** (pas de clé API configurée / complexité)

## Pièges déjà rencontrés (ne pas refaire les mêmes détours)

- **CelesTrak** : throttling/522 observés en interrogeant trop vite après un
  premier appel réussi sur le même groupe. Toujours vérifier le cache KV
  avant de refetch.
- **Limite CPU Workers** : confirmée empiriquement à 10ms/invocation (plan
  gratuit). Toutes les tailles de lot du pipeline de conjonctions sont
  dimensionnées sur des **mesures à froid** (process Node neuf, JIT non
  préchauffé) — les mesures "à chaud" dans un process qui tourne depuis
  longtemps sont ~4x trop optimistes, ne pas s'y fier pour du dimensionnement
  Cloudflare.
- **Filtrage grossier des conjonctions** : un simple filtre altitude+
  inclinaison ne suffit pas — les nuages de débris et les constellations
  s'auto-regroupent en éléments orbitaux (jusqu'à 65% de paires non filtrées
  dans un même nuage). La vraie clé est d'exclure les paires **intra-groupe**
  (même événement d'origine / même constellation), pas d'affiner le filtre
  d'altitude.
- **Cloudflare Queues** : `max_batch_size` doit être 1 pour garantir un
  budget CPU prévisible par invocation (le partage du budget CPU entre
  messages d'un même lot n'est pas documenté clairement — on ne prend pas le
  risque).
- **FK D1** : la table `conjunctions` n'a **pas** de clé étrangère vers
  `objects` (retirée en Phase 5) — `objects` n'est peuplée que pour le groupe
  `stations`, une FK bloquait l'écriture pour tous les autres objets. Les
  noms sont auto-portés dans `conjunctions` (`object_a_name`/`object_b_name`).
- **modelRouter.js tier "fast"** : passe par défaut un plafond de 128 tokens
  côté Cloudflare AI (cascade de retry OpenRouter) — passer explicitement
  `cloudflareAiMaxTokens` pour un texte plus long, sinon troncature en plein
  milieu.
- **Fiabilité du modèle IA** : un modèle 3B bon marché ne respecte pas
  toujours les consignes du system prompt (a par exemple employé "risque de
  collision" malgré l'interdiction explicite). Le briefing ajoute donc un
  avertissement obligatoire **après coup, en dur**, jamais dépendant de ce
  que le modèle a produit.
- **Pas de navigateur pilotable dans cette session** : toute vérification
  visuelle a été faite via `curl`/Node/logs uniquement, jamais un vrai rendu
  browser. C'est précisément pour ça que la session a basculé vers l'app
  Claude Code (accès navigateur interne).

## Matériel de référence disponible (ajouté par l'utilisateur, pas par moi)

- `assets/Images/Globe avec la coquille Starlink.png` — capture d'écran de référence
- `docs/*.pdf` — papier sur un propagateur SGP4 différentiable, fiche USSF sur le 18th Space Defense Squadron

## État actuel — À VÉRIFIER EN PRIORITÉ

Une phase d'habillage visuel vient d'être codée (renommage "Orbital Watch" →
"Sky Orbital", nouvelle palette par catégorie, glassmorphism, skybox
procédural étoiles/Voie lactée/planètes décoratives, lueur sur objet
sélectionné, trace au sol en dégradé, transitions d'ouverture des modals).
**Aucune vérification visuelle réelle n'a été faite** — le code a été relu et
testé pour la syntaxe/absence d'erreurs uniquement.

Direction validée par l'utilisateur via un aperçu séparé (Artifact, palette +
mockup + démo canvas du skybox) avant implémentation — donc le *style* est
déjà approuvé, ce qui reste à faire est de **vérifier que l'implémentation
réelle dans `web/` correspond bien à cet aperçu et ne casse rien**.

Checklist à faire avec un vrai navigateur (`cd web && python3 -m http.server
8080`, ou pointer directement sur le Worker de prod pour les données) :

1. Couleurs par catégorie sur le globe (cyan actifs, vert stations, rouge/orange débris selon événement)
2. Skybox : étoiles + Voie lactée + 5 planètes décoratives visibles en dézoomant, discrètes, aucune interférence avec le picking des objets réels
3. Halo doré sur l'objet sélectionné
4. Trace au sol en dégradé d'opacité (pas une ligne unie)
5. Glassmorphism sur les panneaux (filtres, fiche objet, observateur, modals)
6. Transitions douces à l'ouverture/fermeture des modals (Rapprochements, Briefing) et au changement de sélection d'objet
7. Non-régression : filtres, recherche, clic/sélection sur le globe, panneau observateur/passages, tout doit fonctionner comme avant l'habillage

Si quelque chose cloche visuellement, les fichiers à ajuster sont
`web/style.css` (palette/glass/transitions) et `web/globe.js` (couleurs,
lueur, skybox, trace au sol) — voir les sections correspondantes, chacune
commentée sur le pourquoi des choix techniques.
