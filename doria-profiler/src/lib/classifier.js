// Classification hybride — embeddings (cosinus) + BM25 (lexical)
// Pas de LLM dans la boucle ; coût quasi nul.
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
// Construction des prototypes (mode BASIQUE) :
//   cluster proto = "<nom_cluster> : <sous_cluster_1>, <sous_cluster_2>, ..."
//   subcluster proto = "<nom_cluster> > <nom_sous_cluster>"
// ───────────────────────────────────────────────────────────────────────────
export function buildPrototypes(taxo) {
  const clusters = (taxo?.categories || []).map((c, ci) => {
    const subs = (c.subCategories || []).map((s, si) => ({
      idx: si,
      label: s,
      proto: `${c.name} > ${s}`,
    }));
    return {
      idx: ci,
      label: c.name,
      // Prototype niveau 1 = nom + énumération des sous-clusters (pour diversifier le contexte)
      proto: subs.length
        ? `${c.name} : ${subs.map((s) => s.label).join(", ")}`
        : c.name,
      subclusters: subs,
    };
  });
  return clusters;
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
// Classification d'UN verbatim — retourne cluster + sous-cluster + confidences.
// Args :
//   vEmb : embedding du verbatim (array)
//   vTokens : tokens du verbatim (déjà tokenisé)
//   protos : sortie de buildPrototypes()
//   clusterEmbs : embeddings des protos cluster (même ordre que protos)
//   subEmbs    : embeddings des protos sous-cluster, plat, indexé via subEmbIdx[ci][si]
//   bm25Cluster, bm25SubByCluster : index BM25 pré-calculés
//   weights : { embed, bm25 } (somme = 1)
//   threshold : seuil UNSURE sur le score combiné [0,1]
// ───────────────────────────────────────────────────────────────────────────
export function classifyVerbatim({
  vEmb, vTokens, protos,
  clusterEmbs, subEmbsByCluster,
  bm25Cluster, bm25SubByCluster,
  weights = { embed: 0.7, bm25: 0.3 },
  threshold = 0.5,
}) {
  if (!protos.length) {
    return { cluster: null, subcluster: null, confidence_cluster: 0, confidence_subcluster: 0 };
  }

  // ─── Niveau 1 : cluster ─────────────────────────────────────────────────
  const cosScores = clusterEmbs.map((ce) => Math.max(0, cosine(vEmb, ce))); // clamp ≥ 0
  const bm25Scores = protos.map((_, ci) => bm25Score(vTokens, ci, bm25Cluster));
  const cosNorm = minmax(cosScores);
  const bmNorm = minmax(bm25Scores);
  const combined = cosScores.map((_, i) => weights.embed * cosNorm[i] + weights.bm25 * bmNorm[i]);

  let topIdx = 0;
  for (let i = 1; i < combined.length; i++) if (combined[i] > combined[topIdx]) topIdx = i;
  const topScore = combined[topIdx];

  if (topScore < threshold) {
    return {
      cluster: { idx: -1, label: "UNSURE", id: "UNSURE" },
      subcluster: null,
      confidence_cluster: round3(topScore),
      confidence_subcluster: 0,
      scores: { embed: round3(cosScores[topIdx]), bm25: round3(bm25Scores[topIdx]) },
    };
  }

  const cluster = protos[topIdx];

  // ─── Niveau 2 : sous-cluster ────────────────────────────────────────────
  let subcluster = null;
  let confidence_sub = 0;
  if (cluster.subclusters.length) {
    const subEmbs = subEmbsByCluster[topIdx] || [];
    const bm25Sub = bm25SubByCluster[topIdx];
    const subCos = subEmbs.map((se) => Math.max(0, cosine(vEmb, se)));
    const subBm = cluster.subclusters.map((_, si) => bm25Score(vTokens, si, bm25Sub));
    const subCosNorm = minmax(subCos);
    const subBmNorm = minmax(subBm);
    const subCombined = subCos.map((_, i) => weights.embed * subCosNorm[i] + weights.bm25 * subBmNorm[i]);
    let sIdx = 0;
    for (let i = 1; i < subCombined.length; i++) if (subCombined[i] > subCombined[sIdx]) sIdx = i;
    subcluster = cluster.subclusters[sIdx];
    confidence_sub = subCombined[sIdx];
  }

  return {
    cluster: { idx: cluster.idx, label: cluster.label, id: slug(cluster.label) },
    subcluster: subcluster
      ? { idx: subcluster.idx, label: subcluster.label, id: slug(subcluster.label) }
      : null,
    confidence_cluster: round3(topScore),
    confidence_subcluster: round3(confidence_sub),
    scores: { embed: round3(cosScores[topIdx]), bm25: round3(bm25Scores[topIdx]) },
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
