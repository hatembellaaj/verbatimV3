// Étape 1 — Découverte des clusters
// Soit l'utilisateur génère un arbre par IA depuis un échantillon,
// soit il le saisit manuellement. Arbre éditable (ajout/renommage/suppression).
import React, { useState } from "react";
import { sample, parseJSON } from "../lib/utils.js";
import { callClaude } from "../api/claude.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import CategoryPickerModal from "./CategoryPickerModal.jsx";
import {
  PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

// Prompt minimal — uniquement clusters/sous-clusters (pas de profils psycho à ce stade).
function promptDiscoverClusters(verbatims, contexte = "") {
  return `Tu es analyste sémantique senior. À partir de cet échantillon de verbatims clients${contexte ? ` (contexte : ${contexte})` : ""}, propose une TAXONOMIE THÉMATIQUE inductive :
- 5 à 8 clusters de niveau 1
- 2 à 5 sous-clusters par cluster
- Noms COURTS, NEUTRES, mutuellement exclusifs, vocabulaire client (pas de jargon marketing)

VERBATIMS :
${verbatims.map((v, i) => `${i + 1}. ${v}`).join("\n")}

Renvoie STRICTEMENT ce JSON (pas de prose, pas de markdown) :
{
  "categories": [
    {"name": "...", "subCategories": ["...", "..."]}
  ]
}`;
}

export default function PhaseDiscover({ items, contexte, initialTaxo, onValidate, onBack }) {
  const total = items.length;
  const defaultSize = Math.min(100, total);
  const [sampleSize, setSampleSize] = useState(defaultSize);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [taxo, setTaxo] = useState(initialTaxo || null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function discoverByAI() {
    if (sampleSize < 10) { setError("Au moins 10 verbatims requis"); return; }
    if (sampleSize > total) { setError(`Max ${total} verbatims disponibles`); return; }
    setRunning(true); setError(null);
    try {
      const verbatims = sample(items.map((i) => i.verbatim).filter(Boolean), sampleSize);
      logInfo(`[discover] échantillon de ${verbatims.length} verbatims`);
      const raw = await callClaude(promptDiscoverClusters(verbatims, contexte), {
        label: "discover", maxTokens: 2000,
      });
      const parsed = parseJSON(raw);
      if (!parsed?.categories?.length) throw new Error("Réponse IA invalide (pas de catégories)");
      setTaxo({ categories: parsed.categories });
      logOk(`[discover] ${parsed.categories.length} clusters proposés`);
    } catch (e) {
      logErr(`[discover] ${e.message}`);
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  function manualStart() { setTaxo({ categories: [] }); setError(null); }
  function reset() { setTaxo(null); setError(null); }

  function addCluster() {
    setTaxo({ ...taxo, categories: [...taxo.categories, { name: "Nouveau cluster", subCategories: [] }] });
  }
  function renameCluster(idx, name) {
    setTaxo({ ...taxo, categories: taxo.categories.map((c, i) => i === idx ? { ...c, name } : c) });
  }
  function removeCluster(idx) {
    setTaxo({ ...taxo, categories: taxo.categories.filter((_, i) => i !== idx) });
  }
  function addSubcluster(cIdx) {
    setTaxo({
      ...taxo,
      categories: taxo.categories.map((c, i) =>
        i === cIdx ? { ...c, subCategories: [...c.subCategories, "Nouveau sous-cluster"] } : c
      ),
    });
  }
  function renameSubcluster(cIdx, sIdx, name) {
    setTaxo({
      ...taxo,
      categories: taxo.categories.map((c, i) => {
        if (i !== cIdx) return c;
        return { ...c, subCategories: c.subCategories.map((s, j) => j === sIdx ? name : s) };
      }),
    });
  }
  function removeSubcluster(cIdx, sIdx) {
    setTaxo({
      ...taxo,
      categories: taxo.categories.map((c, i) => {
        if (i !== cIdx) return c;
        return { ...c, subCategories: c.subCategories.filter((_, j) => j !== sIdx) };
      }),
    });
  }

  const canValidate =
    taxo?.categories?.length >= 1 &&
    taxo.categories.every((c) => (c.name || "").trim().length > 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Bandeau d'intro + choix du mode ────────────────────────────────── */}
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>
          Étape 1 — Découverte des clusters
        </h2>
        <p style={{ margin: "0 0 16px 0", color: MUTED, fontSize: 13 }}>
          Construis l'arbre des clusters et sous-clusters thématiques. Tu peux le générer par IA
          depuis un échantillon, ou le saisir entièrement à la main.
        </p>

        {!taxo && (
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>
                Taille de l'échantillon ({total} verbatims dispo au total)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="number"
                  min={10}
                  max={total}
                  step={10}
                  value={sampleSize}
                  onChange={(e) => setSampleSize(Math.max(10, Math.min(total, Number(e.target.value) || 10)))}
                  style={{ ...inputStyle, width: 120 }}
                />
                <span style={{ fontSize: 11, color: MUTED }}>
                  ~{Math.round((sampleSize * 100) / Math.max(total, 1))}% du corpus
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={discoverByAI}
                disabled={running}
                style={{ ...buttonPrimary, opacity: running ? 0.5 : 1 }}
              >
                {running ? "Génération en cours…" : "🤖 Découvrir par IA"}
              </button>
              <button onClick={manualStart} disabled={running} style={buttonSecondary}>
                ✍️ Saisir manuellement
              </button>
              <button
                onClick={() => setPickerOpen(true)}
                disabled={running}
                style={{ ...buttonSecondary, borderColor: TEAL, color: TEAL }}
                title="Charger une catégorie existante (clusters + ancres préchargés)"
              >
                📚 Charger depuis la base
              </button>
            </div>

            {error && (
              <div style={{
                padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
                borderRadius: 8, color: "#FCA5A5", fontSize: 12,
              }}>
                ⚠ {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Arbre éditable ─────────────────────────────────────────────────── */}
      {taxo && (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>
              Arbre des clusters
              <span style={{ marginLeft: 10, color: MUTED, fontWeight: 400, fontSize: 12 }}>
                {taxo.categories.length} cluster{taxo.categories.length > 1 ? "s" : ""} ·{" "}
                {taxo.categories.reduce((acc, c) => acc + c.subCategories.length, 0)} sous-clusters
              </span>
              {taxo._categoryName && (
                <span style={{
                  marginLeft: 10, fontSize: 10, color: TEAL,
                  padding: "2px 8px", background: "rgba(34,211,238,0.1)",
                  border: `1px solid ${TEAL}`, borderRadius: 12, fontWeight: 600,
                }}>
                  📚 chargé : {taxo._categoryName}
                </span>
              )}
            </h3>
            <button onClick={reset} style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11 }}>
              Recommencer
            </button>
          </div>

          {taxo.categories.length === 0 && (
            <div style={{ padding: 12, color: MUTED, fontSize: 12, textAlign: "center", border: `1px dashed ${BORDER}`, borderRadius: 8 }}>
              Arbre vide — clique sur « + Ajouter un cluster » pour commencer.
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {taxo.categories.map((cluster, cIdx) => (
              <div key={cIdx} style={{
                background: PANEL_2, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: 12,
              }}>
                {/* ── Ligne cluster ── */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ color: GOLD, fontSize: 16 }}>📁</span>
                  <input
                    value={cluster.name}
                    onChange={(e) => renameCluster(cIdx, e.target.value)}
                    style={{ ...inputStyle, flex: 1, fontWeight: 600, color: TEXT }}
                    placeholder="Nom du cluster"
                  />
                  <button
                    onClick={() => removeCluster(cIdx)}
                    style={{
                      ...buttonSecondary, padding: "4px 10px", fontSize: 11,
                      color: "#FCA5A5", borderColor: "#EF4444",
                    }}
                  >
                    Supprimer
                  </button>
                </div>

                {/* ── Sous-clusters ── */}
                <div style={{ display: "grid", gap: 6, paddingLeft: 24 }}>
                  {cluster.subCategories.map((sub, sIdx) => (
                    <div key={sIdx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: MUTED, fontSize: 14 }}>└</span>
                      <input
                        value={sub}
                        onChange={(e) => renameSubcluster(cIdx, sIdx, e.target.value)}
                        style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                        placeholder="Sous-cluster"
                      />
                      <button
                        onClick={() => removeSubcluster(cIdx, sIdx)}
                        style={{ ...buttonSecondary, padding: "2px 8px", fontSize: 10, color: MUTED }}
                        title="Supprimer ce sous-cluster"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addSubcluster(cIdx)}
                    style={{
                      ...buttonSecondary, padding: "4px 10px", fontSize: 11,
                      alignSelf: "flex-start", marginLeft: 18,
                    }}
                  >
                    + Ajouter un sous-cluster
                  </button>
                </div>
              </div>
            ))}

            <button onClick={addCluster} style={{ ...buttonSecondary, padding: "8px 14px" }}>
              + Ajouter un cluster
            </button>
          </div>
        </div>
      )}

      {/* ── Footer nav + choix du mode de classification ──────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onBack} style={buttonSecondary}>← Retour import</button>
        {taxo && canValidate && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: MUTED, marginRight: 4 }}>Continuer en :</span>
            <button
              onClick={() => onValidate({ taxo, mode: "embed" })}
              style={buttonSecondary}
              title="Classification locale par embeddings + BM25, gratuite, rapide"
            >
              ⚡ Embeddings (local)
            </button>
            <button
              onClick={() => onValidate({ taxo, mode: "llm" })}
              style={buttonPrimary}
              title="Calibration P1-P4 puis analyse LLM complète (PAD, biais, profils)"
            >
              🤖 Analyse LLM →
            </button>
          </div>
        )}
      </div>
      {taxo && !canValidate && (
        <p style={{ margin: 0, color: MUTED, fontSize: 12, textAlign: "right" }}>
          Au moins 1 cluster avec un nom non vide est requis.
        </p>
      )}

      <CategoryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLoaded={(loadedTaxo) => {
          setTaxo(loadedTaxo);
          setError(null);
        }}
      />
    </div>
  );
}
