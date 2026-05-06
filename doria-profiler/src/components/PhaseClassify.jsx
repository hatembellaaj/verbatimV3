// Phase 4 (alternative) — Classification hybride embeddings + BM25
// Pas d'appel LLM dans la boucle. Coût : 0€ (service local).
// Sortie : items enrichis avec category/subCategory/confidence/evidence.
// Les champs LLM-only (pad, biais, motivations, signaux, psychoProfile) restent null.
import React, { useState, useRef, useEffect } from "react";
import {
  tokenize, buildBM25Index, buildPrototypes, fetchEmbeddings, classifyVerbatim,
} from "../lib/classifier.js";
import { logInfo, logOk, logErr, logWarn } from "../lib/logger.js";
import {
  PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  panelStyle, buttonPrimary, buttonSecondary,
} from "../lib/theme.js";

const CONFIDENCE_THRESHOLD = 0.5;
const EMBED_WEIGHT = 0.7;
const BM25_WEIGHT = 0.3;

export default function PhaseClassify({
  items, taxo, contexte, initialResults, onResultsChange, onValidate, onBack,
}) {
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(null); // 'embed-protos' | 'embed-verbatims' | 'classify' | 'done'
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
    try {
      // ─── 1. Health check du service embed ──────────────────────────────
      logInfo("[classify] Vérification du service /api/embed/health");
      try {
        const h = await fetch("/api/embed/health").then((r) => r.json());
        logOk(`[classify] Service embed OK — modèle ${h.model} (dim ${h.dim})`);
      } catch (e) {
        throw new Error("Service embeddings injoignable. Le container 'embed' tourne-t-il ?");
      }

      // ─── 2. Construction des prototypes ─────────────────────────────────
      const protos = buildPrototypes(taxo);
      if (!protos.length) throw new Error("Taxonomie vide");
      const protoTexts = protos.map((p) => p.proto);
      const subTextsByCluster = protos.map((p) => p.subclusters.map((s) => s.proto));
      logInfo(`[classify] ${protos.length} clusters, ${subTextsByCluster.flat().length} sous-clusters à embedder`);

      // ─── 3. Embeddings prototypes (cluster + sous-cluster, en un seul batch) ──
      setStage("embed-protos");
      setProgress({ done: 0, total: protoTexts.length + subTextsByCluster.flat().length });
      const allProtoTexts = [...protoTexts, ...subTextsByCluster.flat()];
      const allProtoEmbs = await fetchEmbeddings(allProtoTexts, {
        onProgress: ({ done, total }) => setProgress({ done, total }),
      });
      const clusterEmbs = allProtoEmbs.slice(0, protoTexts.length);
      // Reconstruction des sous-cluster embeddings par cluster
      const subEmbsByCluster = [];
      let cursor = protoTexts.length;
      for (const subs of subTextsByCluster) {
        subEmbsByCluster.push(allProtoEmbs.slice(cursor, cursor + subs.length));
        cursor += subs.length;
      }
      logOk(`[classify] Prototypes encodés (${allProtoEmbs.length} vecteurs)`);

      // ─── 4. BM25 — indexes lexicaux ─────────────────────────────────────
      const protoTokens = protoTexts.map(tokenize);
      const bm25Cluster = buildBM25Index(protoTokens);
      const bm25SubByCluster = subTextsByCluster.map((subs) => buildBM25Index(subs.map(tokenize)));

      // ─── 5. Embeddings des verbatims (par lots) ─────────────────────────
      if (cancelRef.current) return;
      setStage("embed-verbatims");
      setProgress({ done: 0, total: items.length });
      const verbatims = items.map((it) => String(it.verbatim || "").slice(0, 2000)); // tronque les outliers
      const verbEmbs = await fetchEmbeddings(verbatims, {
        onProgress: ({ done, total }) => setProgress({ done, total }),
      });
      logOk(`[classify] ${verbEmbs.length} verbatims encodés`);

      // ─── 6. Classification ───────────────────────────────────────────────
      if (cancelRef.current) return;
      setStage("classify");
      setProgress({ done: 0, total: items.length });
      const enriched = [];
      let unsureCount = 0;
      for (let i = 0; i < items.length; i++) {
        if (cancelRef.current) break;
        const v = items[i];
        const vEmb = verbEmbs[i];
        const vTokens = tokenize(verbatims[i]);
        const cls = classifyVerbatim({
          vEmb, vTokens, protos,
          clusterEmbs, subEmbsByCluster,
          bm25Cluster, bm25SubByCluster,
          weights: { embed: EMBED_WEIGHT, bm25: BM25_WEIGHT },
          threshold: CONFIDENCE_THRESHOLD,
        });
        if (cls.cluster?.id === "UNSURE") unsureCount++;

        // Forme compatible avec PhaseResults (ex-PhaseAnalyse)
        enriched.push({
          ...v,
          idx: i,
          category: cls.cluster?.label || "UNSURE",
          subCategory: cls.subcluster?.label || null,
          cluster_id: cls.cluster?.id || "UNSURE",
          subcluster_id: cls.subcluster?.id || null,
          confidence: cls.confidence_cluster,
          confidence_cluster: cls.confidence_cluster,
          confidence_subcluster: cls.confidence_subcluster,
          tonality: null,        // non calculé en mode embeddings
          psychoProfile: null,
          pad: null,
          biais: [],
          motivations: [],
          signaux: [],
          _scores: cls.scores,
          _classifier: "embed+bm25",
        });
        if ((i + 1) % 25 === 0 || i === items.length - 1) {
          setProgress({ done: i + 1, total: items.length });
          // Yield to event loop pour ne pas bloquer l'UI
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const coverage = ((items.length - unsureCount) / Math.max(items.length, 1)) * 100;
      const avgConf = enriched.reduce((s, e) => s + (e.confidence_cluster || 0), 0) / Math.max(enriched.length, 1);
      const stat = {
        total: items.length,
        classified: items.length - unsureCount,
        unsure: unsureCount,
        coverage: Math.round(coverage * 10) / 10,
        avgConfidence: Math.round(avgConf * 1000) / 1000,
      };
      setStats(stat);
      pushResults(enriched);
      setStage("done");
      logOk(`[classify] Terminé — couverture ${stat.coverage}% (${stat.unsure} UNSURE), confiance moyenne ${stat.avgConfidence}`);
    } catch (e) {
      logErr(`[classify] ${e.message}`);
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
    "embed-protos": "Encodage des clusters",
    "embed-verbatims": "Encodage des verbatims",
    "classify": "Classification",
    "done": "Terminé",
  };
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>
          Classification hybride <span style={{ color: MUTED, fontWeight: 400, fontSize: 12 }}>(embeddings Solon + BM25)</span>
        </h2>
        <p style={{ margin: "0 0 12px 0", color: MUTED, fontSize: 13 }}>
          Classification 100% locale. Aucun appel LLM dans la boucle. Score combiné :
          <span style={{ color: TEAL }}> {Math.round(EMBED_WEIGHT * 100)}% embeddings</span> +
          <span style={{ color: TEAL }}> {Math.round(BM25_WEIGHT * 100)}% BM25</span>.
          Verbatims sous le seuil de {CONFIDENCE_THRESHOLD} → bucket <code>UNSURE</code>.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: MUTED, marginBottom: 12 }}>
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
        {running && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: TEAL }}>
              {stageLabels[stage] || "…"} — {progress.done} / {progress.total}
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
        </div>
      )}

      {stats && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>Résultats</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
            <Stat label="Total" value={stats.total} />
            <Stat label="Classés" value={stats.classified} hint={`${stats.coverage}%`} positive />
            <Stat label="UNSURE" value={stats.unsure} hint={`${(100 - stats.coverage).toFixed(1)}%`} negative />
            <Stat label="Confiance moyenne" value={stats.avgConfidence} />
          </div>
        </div>
      )}

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
