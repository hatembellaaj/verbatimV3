// Étape 3 (mode embed) — Génération + édition des ancres sémantiques
// Une ancre = phrase-exemple typique d'un verbatim qui devrait tomber dans le
// cluster/sous-cluster. Ces phrases servent à calculer le centroide
// d'embedding du prototype, ce qui dilue les mots ultra-fréquents du domaine.
//
// L'utilisateur peut générer par IA (un appel par cluster, en parallèle 2-à-2)
// puis éditer librement les phrases : ajouter, modifier, supprimer.
import React, { useState, useRef } from "react";
import { callClaude, MOCK_AI } from "../api/claude.js";
import { promptGenerateAnchorsForCluster } from "../lib/prompts.js";
import { parseJSON, pLimit } from "../lib/utils.js";
import { logInfo, logOk, logErr, logWarn, logLlm, logDbg } from "../lib/logger.js";
import ConsolePanel from "./ConsolePanel.jsx";
import {
  PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const N_CLUSTER_ANCHORS = 5;
const N_SUB_ANCHORS = 4;

export default function PhaseAnchors({ taxo, contexte, onValidate, onBack, onTaxoUpdate }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);

  // ─── Génération par IA — un appel par cluster (parallélisé) ────────────
  async function generateAll() {
    if (MOCK_AI) {
      setError("Génération impossible en mode MOCK (clé API Anthropic requise)");
      return;
    }
    setRunning(true); setError(null); cancelRef.current = false;
    const N = taxo.categories.length;
    setProgress({ done: 0, total: N });
    logLlm(`[anchors] Génération par LLM — ${N} clusters en parallèle (concurrency=2)`);
    const t0 = Date.now();

    const limit = pLimit(2);
    let done = 0;
    const failures = [];

    const tasks = taxo.categories.map((c, idx) => limit(async () => {
      if (cancelRef.current) return c;
      try {
        const tStart = Date.now();
        const raw = await callClaude(
          promptGenerateAnchorsForCluster(c, contexte, N_CLUSTER_ANCHORS, N_SUB_ANCHORS),
          { label: `anchors[${idx}]`, maxTokens: 1500 },
        );
        const parsed = parseJSON(raw);
        if (!parsed) throw new Error(`JSON invalide`);
        const examples = Array.isArray(parsed.examples) ? parsed.examples : [];
        const subAnchors = {};
        for (const sub of (parsed.subclusters || [])) {
          if (Array.isArray(sub.examples)) subAnchors[sub.name] = sub.examples;
        }
        done++;
        setProgress({ done, total: N });
        const subCount = Object.values(subAnchors).reduce((s, a) => s + a.length, 0);
        logOk(`[anchors] "${c.name}" : ${examples.length} ancres + ${subCount} sous-ancres en ${Date.now() - tStart}ms`);
        return { ...c, anchors: examples, subAnchors };
      } catch (e) {
        done++;
        setProgress({ done, total: N });
        logErr(`[anchors] "${c.name}" ÉCHEC : ${e.message}`);
        failures.push(c.name);
        return c;
      }
    }));

    const updatedCategories = await Promise.all(tasks);
    if (failures.length === N) {
      setError(`Tous les appels ont échoué (${N}/${N}). Voir la console.`);
      setRunning(false);
      return;
    }
    if (failures.length > 0) {
      logWarn(`[anchors] ${failures.length} cluster(s) sans ancres : ${failures.join(", ")}`);
    }
    const updated = {
      ...taxo,
      categories: updatedCategories,
      anchorsVersion: new Date().toISOString(),
    };
    if (onTaxoUpdate) onTaxoUpdate(updated);
    const total = updatedCategories.reduce(
      (s, c) => s + (c.anchors?.length || 0) + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0), 0,
    );
    logOk(`[anchors] ${total} ancres totales générées en ${Date.now() - t0}ms`);
    setRunning(false);
  }

  function cancel() {
    cancelRef.current = true;
    setRunning(false);
    logWarn("[anchors] Annulé par l'utilisateur");
  }

  // ─── Édition manuelle des ancres ───────────────────────────────────────
  function updateClusterAnchor(cIdx, aIdx, value) {
    const next = taxo.categories.map((c, i) =>
      i === cIdx
        ? { ...c, anchors: (c.anchors || []).map((a, j) => (j === aIdx ? value : a)) }
        : c
    );
    onTaxoUpdate({ ...taxo, categories: next });
  }
  function addClusterAnchor(cIdx) {
    const next = taxo.categories.map((c, i) =>
      i === cIdx
        ? { ...c, anchors: [...(c.anchors || []), ""] }
        : c
    );
    onTaxoUpdate({ ...taxo, categories: next });
  }
  function removeClusterAnchor(cIdx, aIdx) {
    const next = taxo.categories.map((c, i) =>
      i === cIdx
        ? { ...c, anchors: (c.anchors || []).filter((_, j) => j !== aIdx) }
        : c
    );
    onTaxoUpdate({ ...taxo, categories: next });
  }
  function updateSubAnchor(cIdx, subName, aIdx, value) {
    const next = taxo.categories.map((c, i) => {
      if (i !== cIdx) return c;
      const cur = c.subAnchors?.[subName] || [];
      return {
        ...c,
        subAnchors: { ...c.subAnchors, [subName]: cur.map((a, j) => (j === aIdx ? value : a)) },
      };
    });
    onTaxoUpdate({ ...taxo, categories: next });
  }
  function addSubAnchor(cIdx, subName) {
    const next = taxo.categories.map((c, i) => {
      if (i !== cIdx) return c;
      const cur = c.subAnchors?.[subName] || [];
      return { ...c, subAnchors: { ...c.subAnchors, [subName]: [...cur, ""] } };
    });
    onTaxoUpdate({ ...taxo, categories: next });
  }
  function removeSubAnchor(cIdx, subName, aIdx) {
    const next = taxo.categories.map((c, i) => {
      if (i !== cIdx) return c;
      const cur = c.subAnchors?.[subName] || [];
      return {
        ...c,
        subAnchors: { ...c.subAnchors, [subName]: cur.filter((_, j) => j !== aIdx) },
      };
    });
    onTaxoUpdate({ ...taxo, categories: next });
  }

  // ─── Validation : on garde uniquement les ancres non vides ──────────────
  function handleValidate() {
    // Trim + filtre vides
    const cleanedCategories = taxo.categories.map((c) => ({
      ...c,
      anchors: (c.anchors || []).map((a) => (a || "").trim()).filter(Boolean),
      subAnchors: Object.fromEntries(
        Object.entries(c.subAnchors || {}).map(([k, arr]) => [
          k,
          (arr || []).map((a) => (a || "").trim()).filter(Boolean),
        ])
      ),
    }));
    onValidate({ taxo: { ...taxo, categories: cleanedCategories } });
  }

  // Stats globales
  const totalAnchors = (taxo?.categories || []).reduce((s, c) => s + (c.anchors?.length || 0), 0);
  const totalSubAnchors = (taxo?.categories || []).reduce(
    (s, c) => s + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0), 0,
  );
  const hasAny = totalAnchors > 0 || totalSubAnchors > 0;
  const minClusterAnchors = (taxo?.categories || [])
    .map((c) => (c.anchors || []).filter((a) => (a || "").trim()).length)
    .reduce((a, b) => Math.min(a, b), Infinity);
  const allClustersHaveAnchors = minClusterAnchors >= 1;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Bandeau intro ────────────────────────────────────────────────── */}
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>
          Étape 3 — Phrases-exemples (ancres sémantiques)
        </h2>
        <p style={{ margin: "0 0 12px 0", color: MUTED, fontSize: 13 }}>
          Ces phrases-exemples vont servir à calculer un embedding plus précis
          de chaque cluster et sous-cluster. Plus elles sont représentatives et
          discriminantes (pas trop génériques), meilleure sera la classification.
          Tu peux les générer par IA puis les éditer librement.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: MUTED, marginBottom: 12, flexWrap: "wrap" }}>
          <span><b style={{ color: TEXT }}>{(taxo?.categories || []).length}</b> clusters</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{totalAnchors}</b> ancres cluster</span>
          <span>·</span>
          <span><b style={{ color: TEXT }}>{totalSubAnchors}</b> ancres sous-cluster</span>
          {taxo.anchorsVersion && (
            <>
              <span>·</span>
              <span style={{ color: POS }}>✓ généré le {taxo.anchorsVersion.slice(0, 16).replace("T", " ")}</span>
            </>
          )}
        </div>

        {!running && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={generateAll} style={buttonPrimary} disabled={running}>
              🤖 {hasAny ? "Régénérer toutes les ancres par IA" : "Générer les ancres par IA"}
            </button>
            <span style={{ color: MUTED, fontSize: 11, alignSelf: "center" }}>
              ~$0.05 par génération · {(taxo?.categories || []).length} appels en parallèle
            </span>
          </div>
        )}
        {running && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: TEAL }}>
              Génération en cours — {progress.done} / {progress.total} cluster{progress.total > 1 ? "s" : ""} ({pct}%)
            </div>
            <div style={{ height: 8, background: "#0A1422", border: `1px solid ${BORDER}`, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${TEAL}, ${GOLD})`, transition: "width 0.2s" }} />
            </div>
            <button onClick={cancel} style={{ ...buttonSecondary, alignSelf: "flex-start" }}>Annuler</button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 10, background: "#3B0F14", border: "1px solid #EF4444", borderRadius: 8, color: "#FCA5A5", fontSize: 12 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* ── Arbre éditable cluster par cluster ──────────────────────────── */}
      {(taxo?.categories || []).map((cluster, cIdx) => (
        <div key={cIdx} style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ color: GOLD, fontSize: 16 }}>📁</span>
            <span style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{cluster.name}</span>
            <span style={{ color: MUTED, fontSize: 11 }}>
              {(cluster.anchors || []).filter((a) => (a || "").trim()).length} ancre(s)
            </span>
          </div>

          {/* ── Ancres cluster ── */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              Phrases-exemples du cluster
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {(cluster.anchors || []).map((anchor, aIdx) => (
                <div key={aIdx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: TEAL, fontSize: 12, minWidth: 18 }}>{aIdx + 1}.</span>
                  <input
                    value={anchor}
                    onChange={(e) => updateClusterAnchor(cIdx, aIdx, e.target.value)}
                    style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                    placeholder="Ex : « les toilettes étaient dégueulasses »"
                  />
                  <button
                    onClick={() => removeClusterAnchor(cIdx, aIdx)}
                    style={{ ...buttonSecondary, padding: "2px 8px", fontSize: 10, color: MUTED }}
                    title="Supprimer cette ancre"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => addClusterAnchor(cIdx)}
                style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11, alignSelf: "flex-start" }}
              >
                + Ajouter une ancre
              </button>
            </div>
          </div>

          {/* ── Ancres sous-clusters ── */}
          {(cluster.subCategories || []).length > 0 && (
            <div style={{ paddingLeft: 16, borderLeft: `2px solid ${BORDER}` }}>
              {(cluster.subCategories || []).map((subName) => {
                const subAnchors = cluster.subAnchors?.[subName] || [];
                return (
                  <div key={subName} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: ACCENT, marginBottom: 4, fontWeight: 600 }}>
                      └ {subName} <span style={{ color: MUTED, fontWeight: 400 }}>({subAnchors.filter((a) => (a || "").trim()).length})</span>
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      {subAnchors.map((anchor, aIdx) => (
                        <div key={aIdx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ color: MUTED, fontSize: 11, minWidth: 18 }}>{aIdx + 1}.</span>
                          <input
                            value={anchor}
                            onChange={(e) => updateSubAnchor(cIdx, subName, aIdx, e.target.value)}
                            style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                            placeholder={`Phrase-exemple pour « ${subName} »`}
                          />
                          <button
                            onClick={() => removeSubAnchor(cIdx, subName, aIdx)}
                            style={{ ...buttonSecondary, padding: "2px 6px", fontSize: 9, color: MUTED }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addSubAnchor(cIdx, subName)}
                        style={{ ...buttonSecondary, padding: "2px 8px", fontSize: 10, alignSelf: "flex-start", marginLeft: 24 }}
                      >
                        + Ajouter
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* ── Console + nav ────────────────────────────────────────────────── */}
      <ConsolePanel title="Console — Génération des ancres" defaultOpen={true} maxHeight={260} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={buttonSecondary}>← Retour découverte</button>
        <button
          onClick={handleValidate}
          disabled={!allClustersHaveAnchors || running}
          style={{
            ...buttonPrimary,
            opacity: !allClustersHaveAnchors || running ? 0.45 : 1,
            cursor: !allClustersHaveAnchors || running ? "not-allowed" : "pointer",
          }}
        >
          Valider les ancres → Classification
        </button>
      </div>
      {!allClustersHaveAnchors && hasAny && (
        <p style={{ margin: 0, color: MUTED, fontSize: 12, textAlign: "right" }}>
          Chaque cluster doit avoir au moins une ancre non vide.
        </p>
      )}
      {!hasAny && !running && (
        <p style={{ margin: 0, color: MUTED, fontSize: 12, textAlign: "right" }}>
          Génère ou saisis au moins une ancre par cluster pour continuer.
        </p>
      )}
    </div>
  );
}
