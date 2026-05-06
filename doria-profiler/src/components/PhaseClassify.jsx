// Phase 4 (alternative) — Classification hybride embeddings + BM25, MULTI-LABEL.
// Pas d'appel LLM dans la boucle. Coût : 0€ (service local).
// Sortie : items enrichis avec category/subCategory (top-1) + categories[] (multi).
// Les champs LLM-only (pad, biais, motivations, signaux, psychoProfile) restent null.
import React, { useState, useRef, useEffect } from "react";
import {
  tokenize, buildBM25Index, buildPrototypes, fetchEmbeddings, classifyVerbatim,
} from "../lib/classifier.js";
import { logInfo, logOk, logErr, logWarn, logApi, logDbg } from "../lib/logger.js";
import ConsolePanel from "./ConsolePanel.jsx";
import {
  PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const CONFIDENCE_THRESHOLD = 0.5;
const EMBED_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;
const MULTI_RATIO = 0.85;     // un label secondaire est gardé si son score ≥ 85% du top
const MAX_LABELS = 3;          // nombre max de catégories par verbatim
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
      logInfo(`Paramètres : threshold=${CONFIDENCE_THRESHOLD} · poids embed=${EMBED_WEIGHT} · BM25=${BM25_WEIGHT} · ratio multi=${MULTI_RATIO} · max labels=${MAX_LABELS}`);
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

      // ─── 2. Construction des prototypes ─────────────────────────────────
      const protos = buildPrototypes(taxo);
      if (!protos.length) throw new Error("Taxonomie vide");
      const protoTexts = protos.map((p) => p.proto);
      const subTextsByCluster = protos.map((p) => p.subclusters.map((s) => s.proto));
      const totalSubs = subTextsByCluster.flat().length;
      logInfo(`[protos] ${protos.length} clusters, ${totalSubs} sous-clusters construits`);
      protos.forEach((p, i) => {
        logDbg(`[protos] #${i} cluster="${p.label}" → "${p.proto}" (${p.subclusters.length} sous-clusters)`);
      });

      // ─── 3. Embeddings prototypes ───────────────────────────────────────
      setStage("embed-protos");
      const allProtoTexts = [...protoTexts, ...subTextsByCluster.flat()];
      logApi(`[embed] POST /api/embed/embed pour ${allProtoTexts.length} prototypes (cluster + sous-cluster)`);
      setProgress({ done: 0, total: allProtoTexts.length });
      const tProto = Date.now();
      const allProtoEmbs = await fetchEmbeddings(allProtoTexts, {
        onProgress: ({ done, total }) => {
          setProgress({ done, total });
          logDbg(`[embed] proto batch ${done}/${total}`);
        },
      });
      logOk(`[embed] ${allProtoEmbs.length} prototypes encodés en ${Date.now() - tProto}ms (dim=${allProtoEmbs[0]?.length || 0})`);

      const clusterEmbs = allProtoEmbs.slice(0, protoTexts.length);
      const subEmbsByCluster = [];
      let cursor = protoTexts.length;
      for (const subs of subTextsByCluster) {
        subEmbsByCluster.push(allProtoEmbs.slice(cursor, cursor + subs.length));
        cursor += subs.length;
      }

      // ─── 4. BM25 index ──────────────────────────────────────────────────
      const protoTokens = protoTexts.map(tokenize);
      const bm25Cluster = buildBM25Index(protoTokens);
      const bm25SubByCluster = subTextsByCluster.map((subs) => buildBM25Index(subs.map(tokenize)));
      const vocabSize = bm25Cluster.idf.size;
      logInfo(`[bm25] Index cluster construit : N=${bm25Cluster.N} docs, vocab=${vocabSize} termes, avgDl=${bm25Cluster.avgDl.toFixed(1)}`);
      protos.forEach((p, i) => {
        const tokens = protoTokens[i];
        logDbg(`[bm25] cluster #${i} "${p.label}" tokens=[${tokens.slice(0, 8).join(", ")}${tokens.length > 8 ? "…" : ""}] (${tokens.length} tokens)`);
      });

      // ─── 5. Embeddings verbatims (par lots) ─────────────────────────────
      if (cancelRef.current) return;
      setStage("embed-verbatims");
      setProgress({ done: 0, total: items.length });
      const verbatims = items.map((it) => String(it.verbatim || "").slice(0, 2000));
      const emptyCount = verbatims.filter((v) => !v.trim()).length;
      if (emptyCount > 0) logWarn(`[embed] ${emptyCount} verbatims vides détectés (seront classés UNSURE)`);
      logApi(`[embed] POST /api/embed/embed pour ${verbatims.length} verbatims`);
      const tVerb = Date.now();
      const verbEmbs = await fetchEmbeddings(verbatims, {
        onProgress: ({ done, total }) => {
          setProgress({ done, total });
          if (done % 128 === 0 || done === total) {
            const rate = done / Math.max((Date.now() - tVerb) / 1000, 0.001);
            logDbg(`[embed] verbatim batch ${done}/${total} (${rate.toFixed(0)}/s)`);
          }
        },
      });
      const verbatimMs = Date.now() - tVerb;
      logOk(`[embed] ${verbEmbs.length} verbatims encodés en ${verbatimMs}ms (${(verbEmbs.length / (verbatimMs / 1000)).toFixed(0)}/s)`);

      // ─── 6. Classification ───────────────────────────────────────────────
      if (cancelRef.current) return;
      setStage("classify");
      setProgress({ done: 0, total: items.length });
      logInfo(`[classify] Démarrage classification multi-label (max ${MAX_LABELS} labels/verbatim, ratio ${MULTI_RATIO})`);

      const enriched = [];
      let unsureCount = 0;
      let multiLabelCount = 0;
      let totalLabels = 0;
      const labelDistribution = new Map();

      for (let i = 0; i < items.length; i++) {
        if (cancelRef.current) break;
        const v = items[i];
        const vEmb = verbEmbs[i];
        const vTokens = tokenize(verbatims[i]);

        const result = classifyVerbatim({
          vEmb, vTokens, protos,
          clusterEmbs, subEmbsByCluster,
          bm25Cluster, bm25SubByCluster,
          weights: { embed: EMBED_WEIGHT, bm25: BM25_WEIGHT },
          threshold: CONFIDENCE_THRESHOLD,
          ratio: MULTI_RATIO,
          maxLabels: MAX_LABELS,
        });

        const isUnsure = !result.primary || result.primary.cluster?.id === "UNSURE";
        if (isUnsure) unsureCount++;
        if (result.labels.length > 1) multiLabelCount++;
        totalLabels += Math.max(result.labels.length, 1);
        for (const l of result.labels) {
          labelDistribution.set(l.cluster.label, (labelDistribution.get(l.cluster.label) || 0) + 1);
        }

        // Log détaillé sur les premiers verbatims (échantillon)
        if (i < SAMPLE_LOG_DETAILED) {
          const verbatimPreview = verbatims[i].slice(0, 80).replace(/\s+/g, " ");
          if (isUnsure) {
            logWarn(`[classify] #${i} UNSURE (top=${result.debug.topScore} < ${CONFIDENCE_THRESHOLD}) "${verbatimPreview}…"`);
            const top3 = (result.debug.breakdown || []).slice(0, 3)
              .map((b) => `${b.cluster}=${b.combined}`).join(" · ");
            logDbg(`[classify] #${i} top-3 scores : ${top3}`);
          } else {
            const labelsStr = result.labels
              .map((l) => `${l.cluster.label}${l.subcluster ? ">" + l.subcluster.label : ""} (${l.confidence_cluster})`)
              .join(" + ");
            logOk(`[classify] #${i} → ${labelsStr} | "${verbatimPreview}…"`);
            const top3 = (result.debug.breakdown || []).slice(0, 3)
              .map((b) => `${b.cluster}=${b.combined} (e=${b.embed_norm}, b=${b.bm25_norm})`).join(" · ");
            logDbg(`[classify] #${i} breakdown : ${top3}`);
          }
        }

        // Forme compatible avec PhaseResults (top-1 dans `category`/`subCategory`)
        // et nouveau champ `categories[]` pour le multi-label.
        const primary = result.primary;
        enriched.push({
          ...v,
          idx: i,
          // Compat top-1
          category: primary?.cluster?.label || "UNSURE",
          subCategory: primary?.subcluster?.label || null,
          cluster_id: primary?.cluster?.id || "UNSURE",
          subcluster_id: primary?.subcluster?.id || null,
          confidence: primary?.confidence_cluster || 0,
          confidence_cluster: primary?.confidence_cluster || 0,
          confidence_subcluster: primary?.confidence_subcluster || 0,
          // Multi-label : tableau de tous les labels retenus (vide si UNSURE)
          categories: result.labels.map((l) => ({
            cluster_id: l.cluster.id,
            cluster_label: l.cluster.label,
            subcluster_id: l.subcluster?.id || null,
            subcluster_label: l.subcluster?.label || null,
            confidence_cluster: l.confidence_cluster,
            confidence_subcluster: l.confidence_subcluster,
            scores: l.scores,
          })),
          // Champs LLM non calculés en mode embeddings
          tonality: null,
          psychoProfile: null,
          pad: null,
          biais: [],
          motivations: [],
          signaux: [],
          // Métadonnées de traçabilité
          _classifier: "embed+bm25",
          _scores: primary?.scores || null,
        });

        if ((i + 1) % 25 === 0 || i === items.length - 1) {
          setProgress({ done: i + 1, total: items.length });
          if ((i + 1) % 100 === 0) {
            logInfo(`[classify] ${i + 1}/${items.length} traités (UNSURE: ${unsureCount}, multi-label: ${multiLabelCount})`);
          }
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
    "embed-protos": "Encodage des prototypes",
    "embed-verbatims": "Encodage des verbatims",
    "classify": "Classification multi-label",
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
          Classification 100% locale, sans LLM dans la boucle. Score combiné :
          <span style={{ color: TEAL }}> {Math.round(EMBED_WEIGHT * 100)}% embeddings</span> +
          <span style={{ color: TEAL }}> {Math.round(BM25_WEIGHT * 100)}% BM25</span>.
          Un verbatim peut recevoir <b>jusqu'à {MAX_LABELS} catégories</b> si leurs scores sont ≥ {Math.round(MULTI_RATIO * 100)}% du top.
          Sous le seuil {CONFIDENCE_THRESHOLD} → bucket <code>UNSURE</code>.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: MUTED, marginBottom: 12, flexWrap: "wrap" }}>
          <span><b style={{ color: TEXT }}>{items.length}</b> verbatims</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{(taxo?.categories || []).length}</b> clusters</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{(taxo?.categories || []).reduce((s, c) => s + (c.subCategories?.length || 0), 0)}</b> sous-clusters</span>
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
