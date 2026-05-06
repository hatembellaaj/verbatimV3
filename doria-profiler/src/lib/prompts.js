// Templates de prompts — spec PROFILER v3.0
// Chap II.2 (Calibration 4 passes) + III.2 (Analyse batch) + Couche 5 (Profilage psy)

// Helper : numérote des verbatims pour les passer au LLM
function numbered(verbatims) {
  return verbatims
    .map((v, i) => `${i + 1}. ${typeof v === "string" ? v : v.verbatim || ""}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSE 1 — Découverte (≈100 verbatims)
// Inductif pur : on laisse Claude proposer une taxonomie thématique ET des
// profils psychographiques émergents (Couche 5).
// ─────────────────────────────────────────────────────────────────────────────
export function promptDiscoverP1(verbatims, contexte = "") {
  return `Tu es un analyste sémantique senior. À partir de cet échantillon de verbatims clients${contexte ? ` (contexte sectoriel : ${contexte})` : ""}, tu dois construire DE FAÇON INDUCTIVE :

1) Une TAXONOMIE THÉMATIQUE (Couche 1) : 5 à 8 catégories de premier niveau, chacune avec 2 à 5 sous-catégories. Les noms doivent être COURTS, NEUTRES, MUTUELLEMENT EXCLUSIFS et collés au vocabulaire des clients. Évite les jargons marketing.

2) Une typologie de PROFILS PSYCHOGRAPHIQUES (Couche 5) : 3 à 5 profils émergents qui décrivent les MOTIVATIONS et VALEURS visibles dans les verbatims. Pour chaque profil : nom court, description (1 phrase), 2 à 4 traits saillants.

VERBATIMS À ANALYSER :
${numbered(verbatims)}

Renvoie STRICTEMENT le JSON suivant (aucun autre texte, pas de fences) :
{
  "categories": [
    {"name": "...", "subCategories": ["...", "..."]}
  ],
  "psychoProfiles": [
    {"name": "...", "description": "...", "traits": ["...", "..."]}
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSE 2 — Validation (≈200 verbatims)
// Soumet la taxo P1 + nouveaux verbatims, demande ajustements (fusions, ajouts,
// renommages) avec justification.
// ─────────────────────────────────────────────────────────────────────────────
export function promptValidateP2(taxoDraft, psychoDraft, verbatims) {
  return `Voici une PREMIÈRE TAXONOMIE proposée à partir d'un échantillon de découverte :

TAXONOMIE THÉMATIQUE :
${JSON.stringify(taxoDraft, null, 2)}

PROFILS PSYCHOGRAPHIQUES :
${JSON.stringify(psychoDraft, null, 2)}

NOUVEAUX VERBATIMS (échantillon de validation) :
${numbered(verbatims)}

Vérifie cette taxonomie contre les nouveaux verbatims. Propose des AJUSTEMENTS minimaux pour gagner en couverture et en cohérence : fusions de catégories redondantes, ajout de catégories ou sous-catégories manquantes, renommages plus neutres. Idem pour les profils psychographiques.

Renvoie STRICTEMENT ce JSON (aucun autre texte) :
{
  "categories": [{"name": "...", "subCategories": ["..."]}],
  "psychoProfiles": [{"name": "...", "description": "...", "traits": ["..."]}],
  "changes": ["liste courte des modifications appliquées par rapport à la version précédente"]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSE 3 — Stabilisation (≈200 verbatims)
// La taxo doit converger : peu/pas de changements attendus. On demande
// confirmation ou derniers ajustements mineurs.
// ─────────────────────────────────────────────────────────────────────────────
export function promptStabilizeP3(taxo, psycho, verbatims) {
  return `Voici la TAXONOMIE en cours de stabilisation :

TAXONOMIE :
${JSON.stringify(taxo, null, 2)}

PROFILS PSYCHOGRAPHIQUES :
${JSON.stringify(psycho, null, 2)}

VERBATIMS (échantillon de stabilisation) :
${numbered(verbatims)}

Cette taxonomie doit maintenant CONVERGER. N'apporte que des ajustements MINEURS (renommages, sous-catégories oubliées). Évite les refontes structurelles. Si elle est satisfaisante telle quelle, renvoie-la inchangée.

Renvoie STRICTEMENT ce JSON :
{
  "categories": [{"name": "...", "subCategories": ["..."]}],
  "psychoProfiles": [{"name": "...", "description": "...", "traits": ["..."]}],
  "changes": ["..."],
  "stable": true | false
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSE 4 — Résidus (≈50 verbatims hors-échantillon)
// Vérifie la couverture sur des verbatims qui n'ont pas servi à construire la taxo.
// ─────────────────────────────────────────────────────────────────────────────
export function promptResidusP4(taxo, psycho, verbatims) {
  return `Voici la TAXONOMIE FINALE :

TAXONOMIE :
${JSON.stringify(taxo, null, 2)}

PROFILS PSYCHOGRAPHIQUES :
${JSON.stringify(psycho, null, 2)}

VERBATIMS HORS-ÉCHANTILLON :
${numbered(verbatims)}

Pour chaque verbatim, indique s'il rentre dans la taxonomie existante (oui/non) ET le profil psychographique le plus proche. Estime la COUVERTURE GLOBALE (% de verbatims classables avec confiance ≥ 0.5). Si la couverture est < 90%, propose les ajustements nécessaires.

Renvoie STRICTEMENT ce JSON :
{
  "coverage": 0.0,
  "uncovered": [{"idx": N, "reason": "..."}],
  "adjustments": [{"type": "add_category|add_subcategory|rename|merge", "detail": "..."}]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSE BATCH — Couche 1 + Couche 5 sur 10 verbatims
// PAD = Pleasure/Arousal/Dominance (Mehrabian & Russell 1974) ∈ [-1,+1]
// 7 biais cognitifs : confirmation, halo, récence, ancrage, dissonance,
// comparaison sociale, contraste
// ─────────────────────────────────────────────────────────────────────────────
export function promptAnalyseBatch(taxo, psycho, verbatims, contexte = "") {
  return `TAXONOMIE THÉMATIQUE (figée) :
${JSON.stringify(taxo, null, 2)}

PROFILS PSYCHOGRAPHIQUES (figés) :
${JSON.stringify(psycho, null, 2)}

${contexte ? `CONTEXTE SECTORIEL : ${contexte}\n\n` : ""}Analyse ce batch de verbatims clients. Pour CHAQUE verbatim, produis :
- category + subCategory (depuis la taxo ; "Autre" + null si rien ne colle)
- tonality : "positif" | "négatif" | "neutre" | "mixte"
- confidence : score [0,1] de fiabilité du classement (mets <0.5 si incertain)
- psychoProfile : nom du profil le plus proche (depuis la liste figée)
- pad : { valence, arousal, dominance } chacun dans [-1, +1]
  · valence : tonalité affective (-1 très désagréable → +1 très agréable)
  · arousal : intensité émotionnelle (-1 calme/apathique → +1 excité/agité)
  · dominance : sentiment de contrôle (-1 dominé/passif → +1 dominant/actif)
- biais : sous-ensemble de ["confirmation","halo","récence","ancrage","dissonance","comparaison_sociale","contraste"] (vide si aucun)
- motivations : 1 à 3 motivations sous-jacentes (verbes/noms courts)
- signaux : 1 à 5 mots-clés saillants extraits du verbatim

VERBATIMS :
${numbered(verbatims)}

Renvoie STRICTEMENT ce JSON (un objet items contenant un tableau, pas de prose) :
{
  "items": [
    {
      "idx": 0,
      "category": "...",
      "subCategory": "..." | null,
      "tonality": "...",
      "confidence": 0.0,
      "psychoProfile": "...",
      "pad": {"valence": 0, "arousal": 0, "dominance": 0},
      "biais": ["..."],
      "motivations": ["..."],
      "signaux": ["..."]
    }
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANCRES SÉMANTIQUES — UN APPEL PAR CLUSTER (plus robuste qu'un appel monolithique
// qui sature les max_tokens). Génère nPerCluster phrases pour le cluster + nPerSub
// par sous-cluster. Plusieurs clusters peuvent être traités en parallèle.
// Ces phrases servent d'ancres pour les embeddings : l'embedding du cluster
// devient le centroide de ses ancres, ce qui dilue les mots ultra-fréquents.
// ─────────────────────────────────────────────────────────────────────────────
export function promptGenerateAnchorsForCluster(cluster, contexte = "", nPerCluster = 5, nPerSub = 4) {
  const subList = (cluster.subCategories || [])
    .map((s) => `  - ${s}`)
    .join("\n") || "  (aucun sous-cluster)";

  return `Tu es analyste sémantique senior${contexte ? ` (domaine : ${contexte})` : ""}.

Pour le CLUSTER et ses SOUS-CLUSTERS ci-dessous, génère des phrases-exemples typiques qui pourraient apparaître dans un verbatim client. Ces phrases serviront d'ancres pour la similarité sémantique.

CONTRAINTES STRICTES :
1. Phrases COURTES et NATURELLES (8 à 25 mots), comme dans un avis client réel.
2. Couvre des angles différents : positif, négatif, neutre, formel, familier.
3. ÉVITE les mots ultra-fréquents du domaine ("parc", "Asterix", "journée", "super", "génial") qui n'aident pas à discriminer.
4. N'utilise PAS le nom littéral du cluster/sous-cluster dans la phrase.
5. Exactement ${nPerCluster} phrases pour le cluster, ${nPerSub} pour chaque sous-cluster.

CLUSTER : "${cluster.name}"
SOUS-CLUSTERS :
${subList}

Renvoie STRICTEMENT ce JSON (aucune prose, aucun markdown) :
{
  "examples": ["phrase 1", "phrase 2", "..."],
  "subclusters": [
    {"name": "<nom exact du sous-cluster>", "examples": ["...", "..."]}
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT CONTEXTUEL — uniquement stats agrégées, jamais les verbatims bruts
// (économie de tokens + confidentialité)
// ─────────────────────────────────────────────────────────────────────────────
export function promptContextChat(corpusStats, taxo, psycho, userMessage, history = []) {
  const histText = history
    .slice(-6)
    .map(h => `${h.role === "user" ? "Utilisateur" : "Analyste"}: ${h.content}`)
    .join("\n");
  return `Tu es l'analyste DORIA PROFILER. Tu réponds en français, de manière SYNTHÉTIQUE et ACTIONNABLE, en t'appuyant uniquement sur les statistiques fournies (jamais d'invention).

STATISTIQUES DU CORPUS :
${JSON.stringify(corpusStats, null, 2)}

TAXONOMIE :
${JSON.stringify(taxo, null, 2)}

PROFILS PSYCHOGRAPHIQUES :
${JSON.stringify(psycho, null, 2)}

${histText ? `HISTORIQUE :\n${histText}\n\n` : ""}QUESTION : ${userMessage}

Renvoie STRICTEMENT ce JSON :
{ "message": "réponse en français, max 200 mots, sans markdown lourd" }`;
}
