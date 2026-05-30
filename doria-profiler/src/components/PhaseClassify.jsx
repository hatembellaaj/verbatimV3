// Phase 4 (alternative) — Classification hybride embeddings + BM25, MULTI-LABEL.
// Pas d'appel LLM dans la boucle. Coût : 0€ (service local).
// Sortie : items enrichis avec category/subCategory (top-1) + categories[] (multi).
// Les champs LLM-only (pad, biais, motivations, signaux, psychoProfile) restent null.
import React, { useState, useRef, useEffect } from "react";
import {
  tokenize, buildBM25Index, buildPrototypes, fetchEmbeddings, classifyVerbatim,
  meanNormalize, splitSentences, UNCLASSIFIED_CLUSTER, isUnclassified,
} from "../lib/classifier.js";
import {
  POSITIVE_ANCHORS, NEGATIVE_ANCHORS,
  buildSentimentCentroids, sentimentDelta, computeTonality,
} from "../lib/sentiment.js";
import { logInfo, logOk, logErr, logWarn, logApi, logDbg } from "../lib/logger.js";
import ConsolePanel from "./ConsolePanel.jsx";
import {
  PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const CONFIDENCE_THRESHOLD = 0.5;
const EMBED_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;
const MULTI_RATIO = 0.85;      // un label secondaire est gardé si son score ≥ 85% du top
                               // (s'applique aux clusters ET aux sous-clusters)
                               // PAS DE PLAFOND : un verbatim peut être associé
                               // à autant de catégories/sous-catégories que pertinent
const SAMPLE_LOG_DETAILED = 5; // nb verbatims pour lesquels on log le breakdown complet

export default function PhaseClassify({
  items, taxo, contexte, initialResults, onResultsChange, onValidate, onBack,
}) {
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState(initialResults || null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const cancelRef = useRef(false);

  function pushResults(r) {
    setResults(r);
    if (onResultsChange) onResultsChange(r || []);
  }

  async function run() {
    setRunning(true); setError(null); cancelRef.current = false;
    const t0 = Date.now();
    try {
      logInfo("════════ Démarrage classification hybride ════════");
      logInfo(`Paramètres : threshold=${CONFIDENCE_THRESHOLD} · poids embed=${EMBED_WEIGHT} · BM25=${BM25_WEIGHT} · ratio multi=${MULTI_RATIO} · plafond labels=∞ (sans limite, filtre par ratio uniquement)`);
      logInfo(`Corpus : ${items.length} verbatims · contexte="${contexte || '(aucun)'}"`);

      // ─── 1. Health check du service embed ──────────────────────────────
      logApi("[embed] GET /api/embed/health");
      let health;
      try {
        const r = await fetch("/api/embed/health");
        health = await r.json();
        if (!r.ok || !health.ok) throw new Error(`HTTP ${r.status}`);
        logOk(`[embed] Service OK — modèle "${health.model}", dim ${health.dim}, max_batch ${health.max_batch}`);
      } catch (e) {
        throw new Error(`Service embeddings injoignable (${e.message}). Vérifie que le container 'embed' tourne.`);
      }

      // ─── 2. Vérification des ancres (générées dans la phase Anchors précédente) ─
      const workingTaxo = taxo;
      const hasAnchors = (workingTaxo?.categories || []).some(
        (c) => Array.isArray(c.anchors) && c.anchors.length > 0
      );
      if (!hasAnchors) {
        throw new Error("Aucune ancre dans la taxonomie. Retour à l'étape Ancres pour les générer.");
      }
      const totalAnchors = workingTaxo.categories.reduce(
        (s, c) => s + (c.anchors?.length || 0) + Object.values(c.subAnchors || {}).reduce((ss, arr) => ss + arr.length, 0), 0,
      );
      logInfo(`[anchors] Ancres présentes : ${totalAnchors} au total (version ${workingTaxo.anchorsVersion || "?"})`);

      // ─── 3. Construction des prototypes (avec ancres) ───────────────────
      const protos = buildPrototypes(workingTaxo);
      if (!protos.length) throw new Error("Taxonomie vide");

      // Pour chaque cluster on a un tableau de textes (nom + ancres)
      // → on les flatten pour tout embedder en un seul appel, puis on calcule les centroides
      const flatClusterTexts = [];
      const clusterRanges = []; // [{start, end}] pour reconstituer les groupes
      protos.forEach((p) => {
        clusterRanges.push({ start: flatClusterTexts.length, end: flatClusterTexts.length + p.protoTexts.length });
        flatClusterTexts.push(...p.protoTexts);
      });

      const flatSubTexts = [];
      const subRanges = []; // [[{start,end}, ...], ...] par cluster puis sous-cluster
      protos.forEach((p) => {
        const ranges = [];
        for (const sub of p.subclusters) {
          ranges.push({ start: flatSubTexts.length, end: flatSubTexts.length + sub.protoTexts.length });
          flatSubTexts.push(...sub.protoTexts);
        }
        subRanges.push(ranges);
      });

      const totalSubs = protos.reduce((s, p) => s + p.subclusters.length, 0);
      logInfo(`[protos] ${protos.length} clusters · ${totalSubs} sous-clusters · ${flatClusterTexts.length + flatSubTexts.length} textes-ancres au total`);
      protos.forEach((p, i) => {
        logDbg(`[protos] cluster "${p.label}" → ${p.protoTexts.length} ancres (${p.protoTexts[0]} + ${p.protoTexts.length - 1} exemples)`);
      });

      // ─── 4. Embeddings prototypes + ancres de sentiment (centroides) ────
      setStage("embed-protos");
      // On embed prototypes + ancres positives + ancres négatives en UN SEUL appel
      // pour profiter du batch (les ancres sentiment sont fixes par run).
      const sentimentTexts = [...POSITIVE_ANCHORS, ...NEGATIVE_ANCHORS];
      const allProtoTexts = [...flatClusterTexts, ...flatSubTexts, ...sentimentTexts];
      logApi(`[embed] POST /api/embed/embed pour ${allProtoTexts.length} textes-prototypes (+ ${sentimentTexts.length} ancres de sentiment)`);
      setProgress({ done: 0, total: allProtoTexts.length });
      const tProto = Date.now();
      const allProtoEmbs = await fetchEmbeddings(allProtoTexts, {
        onProgress: ({ done, total }) => {
          setProgress({ done, total });
          logDbg(`[embed] proto batch ${done}/${total}`);
        },
      });
      logOk(`[embed] ${allProtoEmbs.length} embeddings calculés en ${Date.now() - tProto}ms (dim=${allProtoEmbs[0]?.length || 0})`);

      // Centroides sentiment positif / négatif
      const sentimentStartIdx = flatClusterTexts.length + flatSubTexts.length;
      const posEmbs = allProtoEmbs.slice(sentimentStartIdx, sentimentStartIdx + POSITIVE_ANCHORS.length);
      const negEmbs = allProtoEmbs.slice(sentimentStartIdx + POSITIVE_ANCHORS.length);
      const sentimentCentroids = buildSentimentCentroids(posEmbs, negEmbs);
      logInfo(`[sentiment] Centroides pos/neg calculés (${POSITIVE_ANCHORS.length} ancres+, ${NEGATIVE_ANCHORS.length} ancres−)`);

      // Centroide par cluster
      const flatClusterEmbs = allProtoEmbs.slice(0, flatClusterTexts.length);
      // Borné car allProtoEmbs contient maintenant aussi les ancres sentiment à la fin
      const flatSubEmbs = allProtoEmbs.slice(flatClusterTexts.length, flatClusterTexts.length + flatSubTexts.length);
      const clusterEmbs = clusterRanges.map(({ start, end }) =>
        meanNormalize(flatClusterEmbs.slice(start, end))
      );
      const subEmbsByCluster = subRanges.map((ranges) =>
        ranges.map(({ start, end }) => meanNormalize(flatSubEmbs.slice(start, end)))
      );
      logInfo(`[protos] Centroides calculés : ${clusterEmbs.length} clusters + ${subEmbsByCluster.flat().length} sous-clusters`);

      // ─── 5. BM25 index (sur le doc joint nom+ancres → vocab plus riche) ─
      const bm25ClusterDocs = protos.map((p) => p.bm25Doc);
      const bm25Cluster = buildBM25Index(bm25ClusterDocs.map(tokenize));
      const bm25SubByCluster = protos.map((p) => buildBM25Index(p.subBm25Docs.map(tokenize)));
      const vocabSize = bm25Cluster.idf.size;
      logInfo(`[bm25] Index cluster construit : N=${bm25Cluster.N} docs, vocab=${vocabSize} termes, avgDl=${bm25Cluster.avgDl.toFixed(1)}`);
      protos.forEach((p, i) => {
        const tokens = tokenize(p.bm25Doc);
        logDbg(`[bm25] cluster #${i} "${p.label}" → ${tokens.length} tokens, top: [${tokens.slice(0, 10).join(", ")}${tokens.length > 10 ? "…" : ""}]`);
      });

      // ─── 5. Découpage en phrases + embeddings (sentence-level) ─────────
      // On classifie chaque PHRASE séparément puis on agrège les labels
      // au niveau du verbatim (union, dedup, max confidence par paire).
      if (cancelRef.current) return;
      setStage("embed-verbatims");
      const verbatims = items.map((it) => String(it.verbatim || "").slice(0, 2000));
      const emptyCount = verbatims.filter((v) => !v.trim()).length;
      if (emptyCount > 0) logWarn(`[embed] ${emptyCount} verbatims vides détectés (seront classés UNSURE)`);

      // Split chaque verbatim en phrases / chunks, garde un mapping sentenceIdx → verbatimIdx
      const allSentences = [];
      const sentToVerb = []; // sentToVerb[si] = vIdx
      const sentencesByVerb = []; // sentencesByVerb[vi] = [sentIdx, sentIdx, ...]
      for (let vi = 0; vi < verbatims.length; vi++) {
        const sents = splitSentences(verbatims[vi]);
        const indices = [];
        for (const s of sents) {
          indices.push(allSentences.length);
          allSentences.push(s);
          sentToVerb.push(vi);
        }
        sentencesByVerb.push(indices);
      }
      const avgSent = (allSentences.length / Math.max(verbatims.length, 1)).toFixed(2);
      logInfo(`[split] ${verbatims.length} verbatims → ${allSentences.length} phrases (moy ${avgSent}/verbatim)`);

      setProgress({ done: 0, total: allSentences.length });
      logApi(`[embed] POST /api/embed/embed pour ${allSentences.length} phrases`);
      const tVerb = Date.now();
      const sentEmbs = await fetchEmbeddings(allSentences, {
        onProgress: ({ done, total }) => {
          setProgress({ done, total });
          if (done % 256 === 0 || done === total) {
            const rate = done / Math.max((Date.now() - tVerb) / 1000, 0.001);
            logDbg(`[embed] phrase batch ${done}/${total} (${rate.toFixed(0)}/s)`);
          }
        },
      });
      const sentMs = Date.now() - tVerb;
      logOk(`[embed] ${sentEmbs.length} phrases encodées en ${sentMs}ms (${(sentEmbs.length / (sentMs / 1000)).toFixed(0)}/s)`);

      // ─── 6. Classification phrase-par-phrase + agrégation par verbatim ──
      if (cancelRef.current) return;
      setStage("classify");
      setProgress({ done: 0, total: allSentences.length });
      logInfo(`[classify] Démarrage classification SENTENCE-LEVEL multi-label (ratio ${MULTI_RATIO}) sur ${allSentences.length} phrases`);

      // Classifie chaque phrase, accumule par verbatim un Map<key, labelMaxConf>
      // + collecte les deltas de sentiment par phrase pour agrégation finale
      const verbatimLabels = items.map(() => new Map());
      const verbatimSentDeltas = items.map(() => []); // [{ delta, sim_pos, sim_neg }]
      const verbatimDebug = items.map(() => []); // pour les logs détaillés sur les premiers verbatims

      for (let si = 0; si < allSentences.length; si++) {
        if (cancelRef.current) break;
        if ((si + 1) % 100 === 0 || si === allSentences.length - 1) {
          setProgress({ done: si + 1, total: allSentences.length });
        }
        const vIdx = sentToVerb[si];
        const sent = allSentences[si];
        const result = classifyVerbatim({
          vEmb: sentEmbs[si],
          vTokens: tokenize(sent),
          protos,
          clusterEmbs, subEmbsByCluster,
          bm25Cluster, bm25SubByCluster,
          weights: { embed: EMBED_WEIGHT, bm25: BM25_WEIGHT },
          threshold: CONFIDENCE_THRESHOLD,
          ratio: MULTI_RATIO,
        });
        // Sentiment de la phrase (delta + sims pour debug)
        const sentRes = sentimentDelta(sentEmbs[si], sentimentCentroids);
        if (sentRes && typeof sentRes === "object") {
          verbatimSentDeltas[vIdx].push(sentRes);
        }
        // Aggrégation par (cluster_id, subcluster_id) — max confidence.
        // On NE collecte PAS les labels "Non classé" ici : on les déduira en sortie
        // (si après agrégation, aucun label métier n'a été retenu → Non classé).
        for (const lbl of result.labels) {
          if (isUnclassified(lbl.cluster.label)) continue;
          const key = `${lbl.cluster.id}::${lbl.subcluster?.id || ""}`;
          const existing = verbatimLabels[vIdx].get(key);
          if (!existing || lbl.confidence_cluster > existing.confidence_cluster) {
            verbatimLabels[vIdx].set(key, lbl);
          }
        }
        // Capture pour les logs verbeux des 5 premiers verbatims
        if (vIdx < SAMPLE_LOG_DETAILED) {
          verbatimDebug[vIdx].push({ sent, result });
        }
      }

      // Construction des items enrichis
      const enriched = [];
      let unsureCount = 0;
      let multiLabelCount = 0;
      let totalLabels = 0;
      const labelDistribution = new Map();

      for (let i = 0; i < items.length; i++) {
        if (cancelRef.current) break;
        const v = items[i];
        const labelMap = verbatimLabels[i];
        let sortedLabels = [...labelMap.values()]
          .sort((a, b) => b.confidence_cluster - a.confidence_cluster);

        // Si aucun cluster métier ne matche → assigner EXCLUSIVEMENT "Non classé"
        const isUnsure = sortedLabels.length === 0;
        if (isUnsure) {
          unsureCount++;
          sortedLabels = [{
            cluster: { idx: -1, label: UNCLASSIFIED_CLUSTER, id: "non_classe" },
            subcluster: null,
            confidence_cluster: 0,
            confidence_subcluster: 0,
            scores: null,
          }];
        }
        if (sortedLabels.length > 1) multiLabelCount++;
        totalLabels += Math.max(sortedLabels.length, 1);

        // Distribution UNIQUE par cluster (un verbatim avec 2 sub d'un même cluster compte 1×)
        const seenClustersInVerb = new Set();
        for (const l of sortedLabels) {
          if (!seenClustersInVerb.has(l.cluster.label)) {
            labelDistribution.set(l.cluster.label, (labelDistribution.get(l.cluster.label) || 0) + 1);
            seenClustersInVerb.add(l.cluster.label);
          }
        }

        // Logs détaillés pour les premiers verbatims
        if (i < SAMPLE_LOG_DETAILED) {
          const verbatimPreview = verbatims[i].slice(0, 80).replace(/\s+/g, " ");
          const dbg = verbatimDebug[i] || [];
          logInfo(`[classify] #${i} (${dbg.length} phrases) "${verbatimPreview}…"`);
          dbg.forEach((d, j) => {
            const prev = (d.sent || "").slice(0, 60).replace(/\s+/g, " ");
            const labels = d.result.labels.map((l) => `${l.cluster.label}${l.subcluster ? ">" + l.subcluster.label : ""}`).join(" + ") || "UNSURE";
            logDbg(`[classify] #${i}.s${j} "${prev}" → ${labels}`);
          });
          if (isUnsure) {
            logWarn(`[classify] #${i} → aucun label retenu (UNSURE)`);
          } else {
            const labelsStr = sortedLabels
              .map((l) => `${l.cluster.label}${l.subcluster ? ">" + l.subcluster.label : ""} (${l.confidence_cluster})`)
              .join(" + ");
            logOk(`[classify] #${i} → AGRÉGÉ : ${labelsStr}`);
          }
        }

        // ─── Calcul de tonalité (texte + note) ────────────────────────
        const ton = computeTonality(verbatimSentDeltas[i], v?.note);

        // Forme de l'item enrichi
        const primary = sortedLabels[0] || null;
        enriched.push({
          ...v,
          idx: i,
          category: primary?.cluster?.label || "UNSURE",
          subCategory: primary?.subcluster?.label || null,
          cluster_id: primary?.cluster?.id || "UNSURE",
          subcluster_id: primary?.subcluster?.id || null,
          confidence: primary?.confidence_cluster || 0,
          confidence_cluster: primary?.confidence_cluster || 0,
          confidence_subcluster: primary?.confidence_subcluster || 0,
          categories: sortedLabels.map((l) => ({
            cluster_id: l.cluster.id,
            cluster_label: l.cluster.label,
            subcluster_id: l.subcluster?.id || null,
            subcluster_label: l.subcluster?.label || null,
            confidence_cluster: l.confidence_cluster,
            confidence_subcluster: l.confidence_subcluster,
            scores: l.scores,
          })),
          tonality: ton.tonality,
          tonality_source: ton.source,
          tonality_delta: ton.delta,
          psychoProfile: null,
          pad: null,
          biais: [],
          motivations: [],
          signaux: [],
          _classifier: "embed+bm25-sentence",
          _scores: primary?.scores || null,
          _sentenceCount: sentencesByVerb[i]?.length || 0,
          _sentimentDebug: { n_sentences: ton.n_sentences, avg_delta: ton.avg_delta, has_strong_pos: ton.has_strong_pos, has_strong_neg: ton.has_strong_neg },
        });

        if ((i + 1) % 100 === 0 || i === items.length - 1) {
          logInfo(`[classify] ${i + 1}/${items.length} verbatims agrégés (UNSURE: ${unsureCount}, multi-label: ${multiLabelCount})`);
          await new Promise((r) => setTimeout(r, 0)); // yield UI
        }
      }

      // ─── 7. Stats finales ───────────────────────────────────────────────
      const coverage = ((items.length - unsureCount) / Math.max(items.length, 1)) * 100;
      const avgConf = enriched.reduce((s, e) => s + (e.confidence_cluster || 0), 0) / Math.max(enriched.length, 1);
      const avgLabels = totalLabels / Math.max(enriched.length, 1);

      const stat = {
        total: items.length,
        classified: items.length - unsureCount,
        unsure: unsureCount,
        coverage: Math.round(coverage * 10) / 10,
        avgConfidence: Math.round(avgConf * 1000) / 1000,
        multiLabelCount,
        avgLabels: Math.round(avgLabels * 100) / 100,
        elapsedMs: Date.now() - t0,
      };
      setStats(stat);
      pushResults(enriched);
      setStage("done");

      logInfo("──────── Distribution des labels ────────");
      const sorted = [...labelDistribution.entries()].sort((a, b) => b[1] - a[1]);
      sorted.forEach(([label, count]) => {
        const pct = Math.round((count * 100) / items.length);
        logInfo(`  ${label.padEnd(30)} ${String(count).padStart(5)} (${pct}%)`);
      });

      // Distribution de tonalité
      const tonCount = enriched.reduce((acc, e) => {
        acc[e.tonality || "?"] = (acc[e.tonality || "?"] || 0) + 1;
        return acc;
      }, {});
      logInfo("──────── Distribution tonalité ────────");
      ["positif", "neutre", "négatif", "mixte"].forEach((t) => {
        const c = tonCount[t] || 0;
        const pct = Math.round((c * 100) / Math.max(items.length, 1));
        logInfo(`  ${t.padEnd(10)} ${String(c).padStart(5)} (${pct}%)`);
      });
      logOk(`════════ Terminé en ${(stat.elapsedMs / 1000).toFixed(1)}s ════════`);
      logOk(`  Couverture : ${stat.coverage}% · UNSURE : ${stat.unsure}`);
      logOk(`  Multi-label : ${multiLabelCount} verbatims (${Math.round((multiLabelCount * 100) / items.length)}%) · moy. ${stat.avgLabels} labels/verbatim`);
      logOk(`  Confiance moyenne : ${stat.avgConfidence}`);
    } catch (e) {
      logErr(`[classify] ÉCHEC : ${e.message}`);
      console.error(e);
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  function cancel() {
    cancelRef.current = true;
    setRunning(false);
    logWarn("[classify] Annulé par l'utilisateur");
  }

  const stageLabels = {
    "embed-protos": "Encodage des prototypes (centroide)",
    "embed-verbatims": "Encodage des phrases (sentence-level)",
    "classify": "Classification multi-label par phrase + agrégation",
    "done": "Terminé",
  };
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>
          Classification hybride <span style={{ color: MUTED, fontWeight: 400, fontSize: 12 }}>(embeddings Solon + BM25, multi-label)</span>
        </h2>
        <p style={{ margin: "0 0 12px 0", color: MUTED, fontSize: 13 }}>
          Classification 100% locale, sans LLM dans la boucle. <b>Sentence-level</b> :
          chaque verbatim est découpé en phrases, classé phrase par phrase,
          puis les labels sont fusionnés au niveau du verbatim (union, max confidence).
          Score combiné :
          <span style={{ color: TEAL }}> {Math.round(EMBED_WEIGHT * 100)}% embeddings</span> +
          <span style={{ color: TEAL }}> {Math.round(BM25_WEIGHT * 100)}% BM25</span>.
          Pas de plafond sur le nombre de catégories par verbatim — toute phrase qui
          dépasse {CONFIDENCE_THRESHOLD} et dont le score est ≥ {Math.round(MULTI_RATIO * 100)}% du top de sa phrase
          contribue ses labels au verbatim.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: MUTED, marginBottom: 12, flexWrap: "wrap" }}>
          <span><b style={{ color: TEXT }}>{items.length}</b> verbatims</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{(taxo?.categories || []).length}</b> clusters</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{(taxo?.categories || []).reduce((s, c) => s + (c.subCategories?.length || 0), 0)}</b> sous-clusters</span>
          <span>·</span>
          <span style={{ color: POS }}>
            ✓ {(taxo?.categories || []).reduce((s, c) => s + (c.anchors?.length || 0) + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0), 0)} ancres LLM
            <span style={{ color: MUTED, fontSize: 11, marginLeft: 4 }}>
              ({taxo?.anchorsVersion?.slice(0, 16).replace("T", " ") || "version ?"})
            </span>
          </span>
        </div>

        {!running && !results && (
          <button onClick={run} style={buttonPrimary}>
            Lancer la classification
          </button>
        )}
        {!running && results && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={run} style={buttonSecondary}>Relancer</button>
          </div>
        )}
        {running && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: TEAL }}>
              {stageLabels[stage] || "…"} — {progress.done} / {progress.total} ({pct}%)
            </div>
            <div style={{ height: 8, background: "#0A1422", border: `1px solid ${BORDER}`, borderRadius: 999, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${pct}%`,
                background: `linear-gradient(90deg, ${TEAL}, ${GOLD})`,
                transition: "width 0.2s",
              }} />
            </div>
            <button onClick={cancel} style={{ ...buttonSecondary, alignSelf: "flex-start" }}>
              Annuler
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...panelStyle, borderColor: "#EF4444", background: "#3B0F14" }}>
          <div style={{ color: "#FCA5A5", fontSize: 13 }}>⚠ {error}</div>
          <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>
            Détails dans la console ci-dessous (filtre niveau "err").
          </div>
        </div>
      )}

      {stats && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>Résultats</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
            <Stat label="Total" value={stats.total} />
            <Stat label="Classés" value={stats.classified} hint={`${stats.coverage}%`} positive />
            <Stat label="UNSURE" value={stats.unsure} hint={`${(100 - stats.coverage).toFixed(1)}%`} negative />
            <Stat label="Multi-label" value={stats.multiLabelCount} hint={`moy ${stats.avgLabels} labels`} />
            <Stat label="Confiance moy." value={stats.avgConfidence} />
            <Stat label="Durée" value={`${(stats.elapsedMs / 1000).toFixed(1)}s`} />
          </div>
        </div>
      )}

      {/* Console toujours visible — pour suivre les logs en direct */}
      <ConsolePanel title="Console — RAG / Classification" defaultOpen={true} maxHeight={360} />

      {results && stats && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button onClick={onBack} style={buttonSecondary}>← Retour découverte</button>
          <button onClick={() => onValidate({ items: results })} style={buttonPrimary}>
            Voir les résultats →
          </button>
        </div>
      )}
      {!results && !running && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button onClick={onBack} style={buttonSecondary}>← Retour découverte</button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, positive, negative }) {
  const hintColor = positive ? POS : negative ? NEG : ACCENT;
  return (
    <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, color: TEXT, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: hintColor, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
