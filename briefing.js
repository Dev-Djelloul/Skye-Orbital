// Génération du briefing quotidien (Module D / Phase 6).
// Repose sur routeChatCompletion (ai/modelRouter.js, tier "fast") mais reste
// utilisable même sans clé API configurée : en cas d'échec du modèle, un
// briefing minimal est composé directement depuis les données (jamais de
// ligne vide dans `briefings`).

const SCREENING_GROUPS = [
  'stations',
  'starlink',
  'cosmos-1408-debris',
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
];

const RECENT_WINDOW_HOURS = 24;

// Ajouté systématiquement après le contenu généré (IA ou repli), quel que
// soit ce que le modèle a produit — un modèle "fast" bon marché ne respecte
// pas toujours fidèlement la consigne du system prompt sur ce point précis,
// et c'est le seul avertissement du projet qui ne doit jamais dépendre de la
// qualité du modèle.
const MANDATORY_DISCLAIMER =
  'Rappel : les rapprochements mentionnés sont des indicateurs géométriques calculés à partir de TLE publics, ' +
  "pas des alertes de collision au sens opérationnel — ils ne doivent pas être interprétés comme une évaluation " +
  'de risque ou une garantie de sécurité.';

export async function gatherBriefingData(env, getCachedOrFetchTle) {
  const groupResults = await Promise.allSettled(SCREENING_GROUPS.map((g) => getCachedOrFetchTle(env, g)));

  const groupCounts = {};
  let totalObjects = 0;
  SCREENING_GROUPS.forEach((group, i) => {
    const result = groupResults[i];
    const count = result.status === 'fulfilled' ? result.value.objects.length : 0;
    groupCounts[group] = count;
    totalObjects += count;
  });

  const sinceIso = new Date(Date.now() - RECENT_WINDOW_HOURS * 3600000).toISOString();

  const recentConjunctions = await env.DB.prepare(
    `SELECT object_a_name, object_b_name, tca, min_distance
     FROM conjunctions
     WHERE computed_at >= ?
     ORDER BY min_distance ASC
     LIMIT 5`
  )
    .bind(sinceIso)
    .all();

  const totalRecentCount = await env.DB.prepare(`SELECT count(*) as n FROM conjunctions WHERE computed_at >= ?`)
    .bind(sinceIso)
    .first();

  return {
    date: new Date().toISOString().slice(0, 10),
    groupCounts,
    totalObjects,
    conjunctionsFound: totalRecentCount?.n ?? 0,
    notableConjunctions: recentConjunctions.results ?? [],
  };
}

export function buildBriefingPrompt(data) {
  const systemPrompt =
    "Tu es l'assistant narratif de Sky Orbital, un tableau de bord public de suivi de satellites et débris " +
    "spatiaux. Rédige un briefing quotidien court (120-200 mots), factuel et pédagogique, en français, à partir " +
    'des données fournies. Interdiction stricte : ne jamais employer un vocabulaire de risque de collision, de ' +
    'danger, de menace ou de garantie de sécurité (par exemple : risque de collision, pas de danger, situation ' +
    'sous contrôle). Les rapprochements géométriques ne sont PAS des évaluations de risque de collision — ' +
    'décris-les uniquement comme des mesures de distance entre objets, sans qualifier leur dangerosité. ' +
    'Reste sobre, informatif, sans emphase dramatique.';

  const lines = [
    `Date : ${data.date}`,
    `Nombre total d'objets suivis (toutes catégories confondues) : ${data.totalObjects}`,
    'Répartition par catégorie :',
    ...Object.entries(data.groupCounts).map(([g, n]) => `  - ${g} : ${n} objets`),
    `Rapprochements géométriques sous 5 km détectés dans les dernières 24h : ${data.conjunctionsFound}`,
  ];

  if (data.notableConjunctions.length > 0) {
    lines.push('Les plus proches :');
    for (const c of data.notableConjunctions) {
      lines.push(`- ${c.object_a_name} / ${c.object_b_name} : ${c.min_distance.toFixed(1)} km (TCA ${c.tca})`);
    }
  }

  const userPrompt = lines.join('\n');
  return { systemPrompt, userPrompt };
}

export function buildFallbackBriefing(data) {
  const parts = [
    `Sky Orbital suit actuellement ${data.totalObjects} objets en orbite basse (stations, Starlink, débris de ` +
      'quatre événements de fragmentation connus).',
  ];

  if (data.conjunctionsFound > 0) {
    const closest = data.notableConjunctions[0];
    parts.push(
      `${data.conjunctionsFound} rapprochement(s) géométrique(s) sous 5 km ont été identifiés dans les dernières ` +
        `24h. Le plus proche : ${closest.object_a_name} / ${closest.object_b_name} à ${closest.min_distance.toFixed(1)} km.`
    );
  } else {
    parts.push('Aucun rapprochement significatif sous 5 km détecté dans les dernières 24h.');
  }

  return parts.join(' ');
}

export async function generateBriefing(env, { getCachedOrFetchTle, routeChatCompletion }) {
  const data = await gatherBriefingData(env, getCachedOrFetchTle);
  const { systemPrompt, userPrompt } = buildBriefingPrompt(data);

  const result = await routeChatCompletion({
    systemPrompt,
    userPrompt,
    messages: [],
    modelTier: 'fast',
    maxTokens: 400,
    // Sans ceci, le chemin Cloudflare AI du tier "fast" retombe sur le plus
    // petit palier de la cascade de retry OpenRouter (128 tokens) — bien trop
    // court pour 120-200 mots, le texte serait tronqué en plein milieu.
    cloudflareAiMaxTokens: 400,
    temperature: 0.4,
    env,
  });

  const content = result.ok && result.content ? result.content : buildFallbackBriefing(data);
  const modelUsed = result.ok && result.content ? `${result.provider}:${result.model}` : 'fallback-template';

  return { content: `${content}\n\n${MANDATORY_DISCLAIMER}`, modelUsed };
}
