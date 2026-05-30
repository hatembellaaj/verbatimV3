// Calcul de tonalité (positif / négatif / neutre / mixte) — version embeddings.
// Stratégie hybride :
//   1. On embedde des phrases-ancres de polarité (positives / négatives) une fois.
//   2. Pour chaque phrase du verbatim, on calcule delta = sim_pos - sim_neg.
//   3. Détection MIXTE prioritaire : présence simultanée de phrases fortement
//      positives ET négatives → MIXTE quelle que soit la note.
//   4. Sinon, agrégation pondérée delta_texte (70%) + signal_note (30%).
//   5. Red flag d'incohérence si note ↔ texte se contredisent fortement → MIXTE.

import { cosine } from "./classifier.js";

// ─── Ancres de polarité (français) ─────────────────────────────────────────
// Choisies pour couvrir registres formel/familier et différents domaines.
export const POSITIVE_ANCHORS = [
  "j'ai adoré cette expérience, c'était parfait",
  "excellente journée, je recommande sans hésiter",
  "très satisfait du service et de l'accueil",
  "incroyable, on a passé un super moment",
  "génial, à refaire absolument",
  "le top, du début à la fin",
  "rien à redire, parfait",
  "vraiment ravi, je reviendrai",
  "expérience formidable, merci",
  "très belle découverte, on a adoré",
];

export const NEGATIVE_ANCHORS = [
  "très déçu, expérience décevante",
  "à éviter absolument, ne perdez pas votre temps",
  "catastrophique, vraiment pas à la hauteur",
  "scandaleux, jamais plus",
  "horrible, j'ai détesté",
  "nul, perte d'argent",
  "frustrant et décevant",
  "mauvaise expérience, je ne recommande pas",
  "lamentable, c'était nul",
  "très mécontent, problème non résolu",
];

// ─── Helpers ───────────────────────────────────────────────────────────────

// Convertit une note 1-5 en delta de sentiment équivalent
// (signal modéré, pour ne pas écraser le signal texte)
export function noteToDelta(note) {
  const n = Number(note);
  if (!Number.isFinite(n)) return null;
  if (n >= 5) return 0.15;
  if (n >= 4) return 0.05;
  if (n === 3) return 0;
  if (n >= 2) return -0.05;
  return -0.15; // 1 ou inférieur
}

// Centroide L2-normalisé d'un set de vecteurs (réutilise la logique du classifier).
function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return sum;
  for (let i = 0; i < dim; i++) sum[i] /= norm;
  return sum;
}

// ─── API principale ────────────────────────────────────────────────────────

// Pré-calcule les centroides pos/neg à partir des embeddings des ancres.
// Appelé une seule fois par run.
export function buildSentimentCentroids(posEmbeddings, negEmbeddings) {
  return {
    pos: centroid(posEmbeddings),
    neg: centroid(negEmbeddings),
  };
}

// Calcule le delta de sentiment d'UNE phrase contre les centroides pos/neg.
export function sentimentDelta(sentenceEmbedding, centroids) {
  if (!sentenceEmbedding || !centroids?.pos || !centroids?.neg) return 0;
  const sp = cosine(sentenceEmbedding, centroids.pos);
  const sn = cosine(sentenceEmbedding, centroids.neg);
  return { delta: sp - sn, sim_pos: sp, sim_neg: sn };
}

// Détermine la tonalité d'un verbatim à partir des deltas de ses phrases + sa note.
// Args :
//   sentenceDeltas : array de { delta, sim_pos, sim_neg } pour chaque phrase
//   note : valeur brute de la note (peut être string, number, undefined…)
//   opts.strongThreshold (=0.10) : delta à partir duquel on considère "fort"
//   opts.decisionThreshold (=0.05) : delta du verdict positif/négatif/neutre
//   opts.incoherenceThreshold (=0.10) : delta de contradiction note ↔ texte
// Retourne : { tonality, source, delta, has_strong_pos, has_strong_neg, n_sentences, avg_delta }
export function computeTonality(sentenceDeltas, note, opts = {}) {
  const {
    strongThreshold = 0.10,
    decisionThreshold = 0.05,
    incoherenceThreshold = 0.10,
  } = opts;

  const nSent = sentenceDeltas.length;
  if (nSent === 0) {
    return {
      tonality: "neutre", source: "empty", delta: 0,
      has_strong_pos: false, has_strong_neg: false, n_sentences: 0, avg_delta: 0,
    };
  }

  const has_strong_pos = sentenceDeltas.some((s) => s.delta > strongThreshold);
  const has_strong_neg = sentenceDeltas.some((s) => s.delta < -strongThreshold);
  const avg_delta = sentenceDeltas.reduce((s, x) => s + x.delta, 0) / nSent;

  // RÈGLE 1 — Présence simultanée de fort positif ET fort négatif → MIXTE
  if (has_strong_pos && has_strong_neg) {
    return {
      tonality: "mixte", source: "text_mixed",
      delta: round3(avg_delta),
      has_strong_pos, has_strong_neg, n_sentences: nSent, avg_delta: round3(avg_delta),
    };
  }

  // RÈGLE 2 — Combinaison delta texte + signal note (texte prioritaire)
  const noteDelta = noteToDelta(note);
  let final_delta, source;
  if (noteDelta !== null) {
    final_delta = 0.7 * avg_delta + 0.3 * noteDelta;
    source = "text+note";
  } else {
    final_delta = avg_delta;
    source = "text_only";
  }

  // RÈGLE 3 — Détection d'incohérence note ↔ texte (le "mais" caché)
  if (noteDelta !== null) {
    if (noteDelta >= 0.05 && avg_delta < -incoherenceThreshold) {
      return {
        tonality: "mixte", source: "incoherence_note_high_text_low",
        delta: round3(final_delta),
        has_strong_pos, has_strong_neg, n_sentences: nSent, avg_delta: round3(avg_delta),
      };
    }
    if (noteDelta <= -0.05 && avg_delta > incoherenceThreshold) {
      return {
        tonality: "mixte", source: "incoherence_note_low_text_high",
        delta: round3(final_delta),
        has_strong_pos, has_strong_neg, n_sentences: nSent, avg_delta: round3(avg_delta),
      };
    }
  }

  // RÈGLE 4 — Verdict standard
  let tonality;
  if (final_delta > decisionThreshold) tonality = "positif";
  else if (final_delta < -decisionThreshold) tonality = "négatif";
  else tonality = "neutre";

  return {
    tonality, source,
    delta: round3(final_delta),
    has_strong_pos, has_strong_neg, n_sentences: nSent, avg_delta: round3(avg_delta),
  };
}

function round3(x) { return Math.round(x * 1000) / 1000; }
