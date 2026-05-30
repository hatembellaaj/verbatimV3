// Classification hybride — embeddings (cosinus) + BM25 (lexical)
// Pas de LLM dans la boucle ; coût quasi nul.

// Cluster réceptacle pour les verbatims qui ne matchent aucun cluster métier.
// EXCLUSIF : un verbatim qui tombe dans ce cluster ne peut pas être dans un autre.
// Pas d'ancres, pas dans les prototypes (la sélection se fait par défaut quand
// aucun cluster métier ne dépasse le seuil).
export const UNCLASSIFIED_CLUSTER = "Non classé";

// Garantit que la taxo contient le cluster "Non classé" en dernier.
// À appeler après toute modification du tree (génération IA, manuel, chargement DB).
export function ensureUnclassified(taxo) {
  if (!taxo || !Array.isArray(taxo.categories)) {
    return { ...(taxo || {}), categories: [{ name: UNCLASSIFIED_CLUSTER, subCategories: [], _readonly: true }] };
  }
  const existing = taxo.categories.find((c) => c.name === UNCLASSIFIED_CLUSTER);
  if (existing) {
    // Marque readonly et place en dernier
    const others = taxo.categories.filter((c) => c.name !== UNCLASSIFIED_CLUSTER);
    return { ...taxo, categories: [...others, { ...existing, _readonly: true, subCategories: [], anchors: [], subAnchors: {} }] };
  }
  return {
    ...taxo,
    categories: [
      ...taxo.categories,
      { name: UNCLASSIFIED_CLUSTER, subCategories: [], _readonly: true, anchors: [], subAnchors: {} },
    ],
  };
}

export function isUnclassified(name) {
  return name === UNCLASSIFIED_CLUSTER;
}
//
// Pipeline :
//   1. Construire prototypes (texte représentatif) par cluster + sous-cluster.
//   2. Calculer embeddings(prototypes) et embeddings(verbatims) via /api/embed/.
//   3. Pour chaque verbatim :
//        - cosine vs chaque prototype → score embedding
//        - BM25 vs chaque prototype     → score lexical
//        - fusion = 0.7 * cosine + 0.3 * BM25 (normalisés [0,1])
//   4. Top cluster, puis répétition au niveau sous-cluster.
//   5. Si score combiné < seuil → UNSURE.

// ───────────────────────────────────────────────────────────────────────────
// Découpage du verbatim en phrases / chunks pour la classification multi-topic.
// Stratégie :
//   1. split sur les ponctuations fortes (.!?;…\n)
//   2. si un chunk fait > maxWordsPerChunk mots, on le re-split sur les virgules
//   3. on filtre les chunks < minWords mots (bruit)
// Si aucun chunk valide n'émerge, on retourne le verbatim entier en fallback.
// ───────────────────────────────────────────────────────────────────────────
export function splitSentences(text, { minWords = 3, maxWordsPerChunk = 18 } = {}) {
  if (!text) return [];
  const raw = String(text).trim();
  if (!raw) return [];

  // Étape 1 : split sur ponctuations fortes ET sur conjonctions de contraste FR.
  // Les conjonctions ("mais", "cependant", …) sont cruciales pour isoler les
  // bascules de sentiment dans un même verbatim ("super, mais l'attente était nulle").
  const contrastSplit = raw
    // ponctuations fortes
    .split(/(?<=[.!?;…])\s+|\n+/)
    // puis conjonctions de contraste (insensible casse)
    .flatMap((s) =>
      s.split(/\s+(?:mais|cependant|toutefois|néanmoins|en revanche|par contre|sauf que)\s+/i),
    )
    .map((s) => s.trim())
    .filter(Boolean);

  // Étape 2 : si un chunk est encore trop long, on coupe sur les virgules
  const finalChunks = [];
  for (const chunk of contrastSplit) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (words.length <= maxWordsPerChunk) {
      finalChunks.push(chunk);
    } else {
      const subs = chunk.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
      finalChunks.push(...subs);
    }
  }

  // Étape 3 : filtre des chunks trop courts (bruit)
  const filtered = finalChunks.filter(
    (s) => s.split(/\s+/).filter(Boolean).length >= minWords
  );

  // Fallback : si tout a été filtré, on rend le verbatim entier
  return filtered.length ? filtered : [raw];
}

// ───────────────────────────────────────────────────────────────────────────
// Tokenisation FR : minuscule, suppression accents, split mots, stopwords FR.
// ───────────────────────────────────────────────────────────────────────────
const STOPWORDS_FR = new Set([
  "le","la","les","un","une","des","de","du","au","aux","et","ou","mais","donc","or","ni","car",
  "à","a","dans","par","pour","sur","avec","sans","sous","entre","chez","vers","contre","selon",
  "que","qui","quoi","dont","où","ce","cet","cette","ces","mon","ma","mes","ton","ta","tes",
  "son","sa","ses","notre","nos","votre","vos","leur","leurs","je","tu","il","elle","on","nous",
  "vous","ils","elles","me","te","se","y","en","est","sont","été","être","avoir","avait","ai",
  "as","ont","fait","faire","plus","moins","très","trop","aussi","alors","si","ne","pas","ne",
  "n","l","d","s","c","j","m","t","qu","jusqu","aujourd","hui","puis",
]);

export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // supprime accents
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS_FR.has(w));
}

// ───────────────────────────────────────────────────────────────────────────
// BM25 — implémentation standard (k1=1.5, b=0.75)
// `docs` est un tableau de tableaux de tokens (chaque doc déjà tokenisé).
// ───────────────────────────────────────────────────────────────────────────
export function buildBM25Index(docs, { k1 = 1.5, b = 0.75 } = {}) {
  const N = docs.length;
  const docLengths = docs.map((d) => d.length);
  const avgDl = docLengths.reduce((a, x) => a + x, 0) / Math.max(N, 1);

  // Document frequency per term
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(d);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  // IDF avec lissage classique BM25 : log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = new Map();
  for (const [t, f] of df) idf.set(t, Math.log((N - f + 0.5) / (f + 0.5) + 1));

  // Term frequencies par document
  const tf = docs.map((d) => {
    const m = new Map();
    for (const t of d) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });

  return { N, avgDl, docLengths, idf, tf, k1, b };
}

export function bm25Score(queryTokens, docIdx, index) {
  const { tf, docLengths, avgDl, idf, k1, b } = index;
  const docTf = tf[docIdx];
  const dl = docLengths[docIdx];
  let score = 0;
  for (const t of new Set(queryTokens)) {
    const f = docTf.get(t);
    if (!f) continue;
    const termIdf = idf.get(t) || 0;
    const denom = f + k1 * (1 - b + b * (dl / Math.max(avgDl, 1)));
    score += termIdf * ((f * (k1 + 1)) / denom);
  }
  return score;
}

// ───────────────────────────────────────────────────────────────────────────
// Cosine similarity — vecteurs normalisés (Solon retourne des vecteurs L2-norm).
// ───────────────────────────────────────────────────────────────────────────
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // déjà entre -1 et 1, généralement [0,1] pour Solon
}

// Min-max sur un tableau pour ramener dans [0,1]
function minmax(arr) {
  if (!arr.length) return arr;
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  if (span < 1e-9) return arr.map(() => 0);
  return arr.map((v) => (v - lo) / span);
}

// ───────────────────────────────────────────────────────────────────────────
// Construction des prototypes — version multi-textes pour centroide d'embeddings.
// Chaque cluster (et sous-cluster) est décrit par PLUSIEURS textes :
//   - le nom littéral
//   - les ancres LLM si disponibles (taxo.categories[i].anchors / subAnchors)
// L'embedding final du prototype est le centroide (moyenne L2-normalisée) des
// embeddings de tous ces textes, ce qui dilue les mots fréquents du domaine.
//
// Sortie pour chaque cluster :
//   { idx, label, protoTexts: [t1, t2, ...], subclusters: [{idx, label, protoTexts: [...]}] }
// Le 1er texte est toujours le nom (utilisé seul pour BM25).
// ───────────────────────────────────────────────────────────────────────────
export function buildPrototypes(taxo) {
  // On exclut le cluster "Non classé" — il n'a pas d'ancres et ne participe pas
  // à la sélection. Il sera assigné par défaut quand aucun autre ne matche.
  const sourceCategories = (taxo?.categories || []).filter((c) => !isUnclassified(c.name));
  const clusters = sourceCategories.map((c, ci) => {
    const clusterAnchors = Array.isArray(c.anchors) ? c.anchors : [];
    const subs = (c.subCategories || []).map((s, si) => {
      const subAnchorList = c.subAnchors?.[s];
      const protoTexts = [`${c.name} > ${s}`]; // forme contextualisée
      if (Array.isArray(subAnchorList)) protoTexts.push(...subAnchorList);
      return { idx: si, label: s, protoTexts };
    });
    const protoTexts = [c.name];
    if (clusterAnchors.length) protoTexts.push(...clusterAnchors);
    return {
      idx: ci,
      label: c.name,
      protoTexts,
      subclusters: subs,
      // Texte joint utilisé pour BM25 (vocabulaire enrichi par les ancres)
      bm25Doc: [c.name, ...clusterAnchors].join(" "),
      subBm25Docs: subs.map((s) => s.protoTexts.join(" ")),
    };
  });
  return clusters;
}

// Moyenne L2-normalisée d'un set de vecteurs (centroide pour cosine).
export function meanNormalize(vectors) {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  // Moyenne
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  // Normalisation L2 pour que cosine = produit scalaire
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return sum;
  for (let i = 0; i < dim; i++) sum[i] /= norm;
  return sum;
}

// ───────────────────────────────────────────────────────────────────────────
// Appel HTTP au service /api/embed/embed (batch).
// ───────────────────────────────────────────────────────────────────────────
export async function fetchEmbeddings(texts, { batchSize = 128, onProgress = null } = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch("/api/embed/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: batch, normalize: true }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Embed HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    out.push(...(data.embeddings || []));
    if (onProgress) onProgress({ done: out.length, total: texts.length });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Classification MULTI-LABEL d'UN verbatim — pas de plafond sur le nombre
// de catégories ni de sous-catégories. Un verbatim peut être associé à
// plusieurs clusters ET, dans chaque cluster retenu, à plusieurs sous-clusters
// si leurs scores sont ≥ ratio × top.
//
// Retourne :
//   - primary : top-1 label (premier de la liste)
//   - labels  : tous les couples (cluster, sous-cluster) retenus
//   - debug   : breakdown complet des scores
// Args :
//   vEmb, vTokens, protos, clusterEmbs, subEmbsByCluster,
//   bm25Cluster, bm25SubByCluster
//   weights : { embed, bm25 } (somme = 1)
//   threshold  : seuil absolu UNSURE sur le score combiné [0,1]
//   ratio      : ratio min vs top pour qu'un label secondaire soit retenu (0.85 par défaut)
//   maxLabels  : optionnel, plafond — par défaut Infinity (pas de limite)
// ───────────────────────────────────────────────────────────────────────────
export function classifyVerbatim({
  vEmb, vTokens, protos,
  clusterEmbs, subEmbsByCluster,
  bm25Cluster, bm25SubByCluster,
  weights = { embed: 0.7, bm25: 0.3 },
  threshold = 0.5,
  ratio = 0.85,
  maxLabels = Infinity,
}) {
  if (!protos.length) {
    return {
      primary: null,
      labels: [],
      debug: { reason: "no_protos" },
    };
  }

  // ─── Niveau 1 : score chaque cluster ────────────────────────────────────
  const cosScores = clusterEmbs.map((ce) => Math.max(0, cosine(vEmb, ce)));
  const bm25Scores = protos.map((_, ci) => bm25Score(vTokens, ci, bm25Cluster));
  const cosNorm = minmax(cosScores);
  const bmNorm = minmax(bm25Scores);
  const combined = cosScores.map((_, i) => weights.embed * cosNorm[i] + weights.bm25 * bmNorm[i]);

  // Top index
  let topIdx = 0;
  for (let i = 1; i < combined.length; i++) if (combined[i] > combined[topIdx]) topIdx = i;
  const topScore = combined[topIdx];

  // Breakdown détaillé pour les logs (toujours, même UNSURE)
  const breakdown = protos
    .map((p, i) => ({
      cluster: p.label,
      cluster_id: slug(p.label),
      combined: round3(combined[i]),
      embed_raw: round3(cosScores[i]),
      embed_norm: round3(cosNorm[i]),
      bm25_raw: round3(bm25Scores[i]),
      bm25_norm: round3(bmNorm[i]),
    }))
    .sort((a, b) => b.combined - a.combined);

  // ─── "Non classé" si le meilleur score est sous le seuil absolu ─────────
  // Cluster EXCLUSIF : un seul label = Non classé, jamais combiné.
  if (topScore < threshold) {
    const unclassifiedLabel = {
      cluster: { idx: -1, label: UNCLASSIFIED_CLUSTER, id: slug(UNCLASSIFIED_CLUSTER) },
      subcluster: null,
      confidence_cluster: round3(topScore),
      confidence_subcluster: 0,
      scores: { embed: round3(cosScores[topIdx] || 0), bm25: round3(bm25Scores[topIdx] || 0) },
    };
    return {
      primary: unclassifiedLabel,
      labels: [unclassifiedLabel],
      debug: { topScore: round3(topScore), threshold, breakdown: breakdown.slice(0, 5), reason: "below_threshold" },
    };
  }

  // ─── Sélection multi-cluster : top + tous ≥ ratio × top, pas de plafond ──
  const minScore = Math.max(threshold, ratio * topScore);
  const keptIdx = combined
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, maxLabels) // Infinity par défaut → pas de plafond
    .map((x) => x.i);

  // ─── Pour CHAQUE cluster retenu, on retient AUSSI plusieurs sous-clusters
  // si leurs scores sont ≥ ratio × top sub-score. Émet une entrée par couple.
  const labels = [];
  for (const ci of keptIdx) {
    const cluster = protos[ci];
    const clusterCombined = combined[ci];

    if (!cluster.subclusters.length) {
      labels.push({
        cluster: { idx: cluster.idx, label: cluster.label, id: slug(cluster.label) },
        subcluster: null,
        confidence_cluster: round3(clusterCombined),
        confidence_subcluster: 0,
        scores: { embed: round3(cosScores[ci]), bm25: round3(bm25Scores[ci]) },
      });
      continue;
    }

    const subEmbs = subEmbsByCluster[ci] || [];
    const bm25Sub = bm25SubByCluster[ci];
    const subCos = subEmbs.map((se) => Math.max(0, cosine(vEmb, se)));
    const subBm = cluster.subclusters.map((_, si) => bm25Score(vTokens, si, bm25Sub));
    const subCosNorm = minmax(subCos);
    const subBmNorm = minmax(subBm);
    const subComb = subCos.map((_, i) => weights.embed * subCosNorm[i] + weights.bm25 * subBmNorm[i]);

    // Top sub
    let topSubIdx = 0;
    for (let i = 1; i < subComb.length; i++) if (subComb[i] > subComb[topSubIdx]) topSubIdx = i;
    const topSubScore = subComb[topSubIdx];
    const subMinScore = ratio * topSubScore;

    // Multi-sous-cluster : tous les sous ≥ ratio × top, pas de plafond
    const subKept = subComb
      .map((s, i) => ({ i, s }))
      .filter((x) => x.s >= subMinScore && x.s > 0)
      .sort((a, b) => b.s - a.s);

    if (!subKept.length) {
      // Aucun sous au-dessus du ratio (cas dégénéré : tous nuls) — on retient quand même le top
      subKept.push({ i: topSubIdx, s: topSubScore });
    }

    for (const { i: sIdx, s: sScore } of subKept) {
      const sub = cluster.subclusters[sIdx];
      labels.push({
        cluster: { idx: cluster.idx, label: cluster.label, id: slug(cluster.label) },
        subcluster: { idx: sub.idx, label: sub.label, id: slug(sub.label) },
        confidence_cluster: round3(clusterCombined),
        confidence_subcluster: round3(sScore),
        scores: { embed: round3(cosScores[ci]), bm25: round3(bm25Scores[ci]) },
      });
    }
  }

  return {
    primary: labels[0],
    labels,
    debug: {
      topScore: round3(topScore),
      minScore: round3(minScore),
      keptClusters: keptIdx.length,
      keptLabels: labels.length,
      breakdown: breakdown.slice(0, 5),
    },
  };
}

function round3(x) { return Math.round(x * 1000) / 1000; }
function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
