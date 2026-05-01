// Phase 2 — Calibration inductive en 4 passes
// spec § II.2 : P1 Découverte (100), P2 Validation (200), P3 Stabilisation (200),
// P4 Résidus (50 hors-échantillon).
import React, { useState } from "react";
import { sample, parseJSON } from "../lib/utils.js";
import { callClaude, MOCK_AI } from "../api/claude.js";
import {
  promptDiscoverP1, promptValidateP2, promptStabilizeP3, promptResidusP4,
} from "../lib/prompts.js";
import { logInfo, logOk, logWarn, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG, NEUTRAL,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const PASSES = [
  { id: "P1", label: "Découverte", target: 100, description: "Échantillon initial — taxonomie inductive" },
  { id: "P2", label: "Validation", target: 200, description: "Nouveaux verbatims — ajustements" },
  { id: "P3", label: "Stabilisation", target: 200, description: "Convergence — ajustements mineurs" },
  { id: "P4", label: "Résidus", target: 50, description: "Hors-échantillon — vérification couverture" },
];

export default function PhaseCalibrate({ items, contexte, onValidate, onBack }) {
  const [running, setRunning] = useState(false);
  const [currentPass, setCurrentPass] = useState(null); // 'P1'|'P2'|'P3'|'P4'
  const [taxo, setTaxo] = useState(null);
  const [psycho, setPsycho] = useState(null);
  const [history, setHistory] = useState([]); // [{ pass, taxo, psycho, changes }]
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);

  // Échantillonnage : on tire sans remise pour les passes 1-3, hors-échantillon pour P4
  function drawSamples() {
    const verbatims = items.map((i) => i.verbatim);
    const n1 = Math.min(PASSES[0].target, Math.floor(verbatims.length * 0.2));
    const n2 = Math.min(PASSES[1].target, Math.floor(verbatims.length * 0.4));
    const n3 = Math.min(PASSES[2].target, Math.floor(verbatims.length * 0.4));
    const n4 = Math.min(PASSES[3].target, Math.max(0, verbatims.length - n1 - n2 - n3));
    const shuffled = sample(verbatims, verbatims.length);
    return {
      P1: shuffled.slice(0, n1),
      P2: shuffled.slice(n1, n1 + n2),
      P3: shuffled.slice(n1 + n2, n1 + n2 + n3),
      P4: shuffled.slice(n1 + n2 + n3, n1 + n2 + n3 + n4),
    };
  }

  async function runFullCalibration() {
    setRunning(true);
    setError(null);
    setHistory([]);
    setTaxo(null);
    setPsycho(null);
    setCoverage(null);

    logInfo("════════ Démarrage calibration 4 passes ════════");

    try {
      const samples = drawSamples();
      logInfo(`Échantillons : P1=${samples.P1.length} · P2=${samples.P2.length} · P3=${samples.P3.length} · P4=${samples.P4.length}`);

      // P1 — Découverte
      setCurrentPass("P1");
      logInfo(`P1 — Découverte (${samples.P1.length} verbatims)`);
      const r1 = parseJSON(await callClaude(promptDiscoverP1(samples.P1, contexte), { maxTokens: 3000, label: "P1 Découverte" }));
      if (!r1?.categories || !r1?.psychoProfiles) {
        logErr("P1 : réponse invalide (catégories ou profils manquants)", r1);
        throw new Error("P1 : taxonomie invalide");
      }
      let curTaxo = { categories: r1.categories };
      let curPsycho = { profiles: r1.psychoProfiles };
      setTaxo(curTaxo); setPsycho(curPsycho);
      setHistory((h) => [...h, { pass: "P1", taxo: curTaxo, psycho: curPsycho, changes: ["Taxonomie initiale créée"] }]);
      logOk(`P1 OK : ${r1.categories.length} catégories · ${r1.psychoProfiles.length} profils`);

      // P2 — Validation
      setCurrentPass("P2");
      logInfo(`P2 — Validation (${samples.P2.length} verbatims)`);
      const r2 = parseJSON(await callClaude(promptValidateP2(curTaxo.categories, curPsycho.profiles, samples.P2), { maxTokens: 3500, label: "P2 Validation" }));
      if (r2?.categories) curTaxo = { categories: r2.categories };
      if (r2?.psychoProfiles) curPsycho = { profiles: r2.psychoProfiles };
      setTaxo(curTaxo); setPsycho(curPsycho);
      setHistory((h) => [...h, { pass: "P2", taxo: curTaxo, psycho: curPsycho, changes: r2?.changes || [] }]);
      logOk(`P2 OK : ${(r2?.changes || []).length} ajustements`);

      // P3 — Stabilisation
      setCurrentPass("P3");
      logInfo(`P3 — Stabilisation (${samples.P3.length} verbatims)`);
      const r3 = parseJSON(await callClaude(promptStabilizeP3(curTaxo.categories, curPsycho.profiles, samples.P3), { maxTokens: 3500, label: "P3 Stabilisation" }));
      if (r3?.categories) curTaxo = { categories: r3.categories };
      if (r3?.psychoProfiles) curPsycho = { profiles: r3.psychoProfiles };
      setTaxo(curTaxo); setPsycho(curPsycho);
      setHistory((h) => [...h, { pass: "P3", taxo: curTaxo, psycho: curPsycho, changes: r3?.changes || [] }]);
      logOk(`P3 OK : stable=${r3?.stable === true}`);

      // P4 — Résidus
      if (samples.P4.length > 0) {
        setCurrentPass("P4");
        logInfo(`P4 — Résidus hors-échantillon (${samples.P4.length} verbatims)`);
        const r4 = parseJSON(await callClaude(promptResidusP4(curTaxo.categories, curPsycho.profiles, samples.P4), { maxTokens: 2500, label: "P4 Résidus" }));
        setCoverage(r4?.coverage ?? null);
        setHistory((h) => [...h, { pass: "P4", taxo: curTaxo, psycho: curPsycho, changes: [`Couverture : ${Math.round((r4?.coverage || 0) * 100)}%`] }]);
        logOk(`P4 OK : couverture ${Math.round((r4?.coverage || 0) * 100)}%`);
      }

      setCurrentPass(null);
      logOk("════════ Calibration terminée ════════");
    } catch (e) {
      logErr(`Calibration échouée : ${e.message}`);
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  function updateCategoryName(idx, val) {
    const next = { ...taxo, categories: taxo.categories.map((c, i) => i === idx ? { ...c, name: val } : c) };
    setTaxo(next);
  }
  function updateSubCategory(catIdx, subIdx, val) {
    const next = {
      ...taxo,
      categories: taxo.categories.map((c, i) => i === catIdx
        ? { ...c, subCategories: c.subCategories.map((s, j) => j === subIdx ? val : s) }
        : c),
    };
    setTaxo(next);
  }
  function addSubCategory(catIdx) {
    const next = {
      ...taxo,
      categories: taxo.categories.map((c, i) => i === catIdx
        ? { ...c, subCategories: [...c.subCategories, "Nouvelle"] }
        : c),
    };
    setTaxo(next);
  }
  function removeSubCategory(catIdx, subIdx) {
    const next = {
      ...taxo,
      categories: taxo.categories.map((c, i) => i === catIdx
        ? { ...c, subCategories: c.subCategories.filter((_, j) => j !== subIdx) }
        : c),
    };
    setTaxo(next);
  }
  function addCategory() {
    setTaxo({ ...taxo, categories: [...taxo.categories, { name: "Nouvelle catégorie", subCategories: [] }] });
  }
  function removeCategory(idx) {
    setTaxo({ ...taxo, categories: taxo.categories.filter((_, i) => i !== idx) });
  }

  function updateProfile(idx, key, val) {
    const next = { ...psycho, profiles: psycho.profiles.map((p, i) => i === idx ? { ...p, [key]: val } : p) };
    setPsycho(next);
  }
  function addProfile() {
    setPsycho({ ...psycho, profiles: [...psycho.profiles, { name: "Nouveau profil", description: "", traits: [] }] });
  }
  function removeProfile(idx) {
    setPsycho({ ...psycho, profiles: psycho.profiles.filter((_, i) => i !== idx) });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>Phase 2 — Calibration inductive</h2>
        <p style={{ margin: "0 0 12px 0", color: MUTED, fontSize: 13 }}>
          4 passes successives sur des échantillons distincts pour faire émerger une taxonomie thématique
          ET des profils psychographiques. Coût estimé : ~{MOCK_AI ? "0 $ (mode démo)" : "0,30-0,60 $"}.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {PASSES.map((p) => {
            const done = history.find((h) => h.pass === p.id);
            const active = currentPass === p.id;
            return (
              <div
                key={p.id}
                style={{
                  background: PANEL_2,
                  border: `1px solid ${active ? GOLD : done ? POS : BORDER}`,
                  borderRadius: 10,
                  padding: 12,
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{p.id}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.label}</div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{p.target} verbatims</div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>{p.description}</div>
                {done && <div style={{ position: "absolute", top: 8, right: 10, color: POS }}>✓</div>}
                {active && (
                  <div style={{ position: "absolute", top: 8, right: 10, color: GOLD, animation: "pulse 1s infinite" }}>●</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={runFullCalibration}
            disabled={running}
            style={{ ...buttonPrimary, opacity: running ? 0.5 : 1 }}
          >
            {running ? `Calibration en cours… (${currentPass || "…"})` : taxo ? "Relancer la calibration" : "Lancer la calibration"}
          </button>
          {taxo && !running && (
            <button onClick={() => setEditMode(!editMode)} style={buttonSecondary}>
              {editMode ? "Verrouiller" : "Éditer la taxonomie"}
            </button>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: 12, background: "#3B0F14", border: `1px solid ${NEG}`, borderRadius: 8, color: "#FCA5A5", fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}
        {MOCK_AI && (
          <div style={{ marginTop: 12, padding: 10, background: "#1F2937", border: `1px solid ${ACCENT}`, borderRadius: 8, color: ACCENT, fontSize: 12 }}>
            ℹ Mode démo (pas de clé API détectée). Une taxonomie factice sera générée. Configure <code>VITE_ANTHROPIC_API_KEY</code> dans <code>.env.local</code> pour passer en mode réel.
          </div>
        )}
      </div>

      {taxo && (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Taxonomie thématique ({taxo.categories.length} catégories)</h3>
            {editMode && <button onClick={addCategory} style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 12 }}>+ Ajouter catégorie</button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            {taxo.categories.map((c, ci) => (
              <div key={ci} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
                {editMode ? (
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    <input
                      value={c.name}
                      onChange={(e) => updateCategoryName(ci, e.target.value)}
                      style={{ ...inputStyle, fontWeight: 600 }}
                    />
                    <button onClick={() => removeCategory(ci)} style={{ ...buttonSecondary, padding: "6px 10px", color: NEG, borderColor: NEG }}>×</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 8 }}>{c.name}</div>
                )}
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                  {c.subCategories.map((s, si) => (
                    <li key={si} style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 4 }}>
                      {editMode ? (
                        <>
                          <input value={s} onChange={(e) => updateSubCategory(ci, si, e.target.value)} style={{ ...inputStyle, padding: "4px 8px", fontSize: 12 }} />
                          <button onClick={() => removeSubCategory(ci, si)} style={{ background: "transparent", border: "none", color: NEG, cursor: "pointer" }}>×</button>
                        </>
                      ) : (
                        <>· {s}</>
                      )}
                    </li>
                  ))}
                  {editMode && (
                    <li>
                      <button onClick={() => addSubCategory(ci)} style={{ ...buttonSecondary, padding: "4px 8px", fontSize: 11, marginTop: 4 }}>+ sous-catégorie</button>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {psycho && (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Profils psychographiques ({psycho.profiles.length})</h3>
            {editMode && <button onClick={addProfile} style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 12 }}>+ Ajouter profil</button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
            {psycho.profiles.map((p, pi) => (
              <div key={pi} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
                {editMode ? (
                  <>
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <input value={p.name} onChange={(e) => updateProfile(pi, "name", e.target.value)} style={{ ...inputStyle, fontWeight: 600 }} />
                      <button onClick={() => removeProfile(pi)} style={{ ...buttonSecondary, padding: "6px 10px", color: NEG, borderColor: NEG }}>×</button>
                    </div>
                    <textarea
                      value={p.description}
                      onChange={(e) => updateProfile(pi, "description", e.target.value)}
                      rows={2}
                      style={{ ...inputStyle, fontFamily: "inherit", fontSize: 12, marginBottom: 6 }}
                    />
                    <input
                      value={(p.traits || []).join(", ")}
                      onChange={(e) => updateProfile(pi, "traits", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
                      placeholder="traits séparés par virgules"
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 600, color: ACCENT, marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: TEXT, marginBottom: 8, lineHeight: 1.5 }}>{p.description}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(p.traits || []).map((t, ti) => (
                        <span key={ti} style={{ fontSize: 10, background: PANEL, border: `1px solid ${BORDER}`, padding: "2px 8px", borderRadius: 12, color: MUTED }}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 8px 0", color: TEAL, fontSize: 15 }}>Historique des passes</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {history.map((h, i) => (
              <div key={i} style={{ fontSize: 12, color: MUTED, paddingLeft: 8, borderLeft: `2px solid ${ACCENT}` }}>
                <strong style={{ color: TEXT }}>{h.pass}</strong> — {h.changes.length ? h.changes.join(" · ") : "Aucun changement"}
              </div>
            ))}
            {coverage != null && (
              <div style={{ fontSize: 13, color: coverage >= 0.9 ? POS : NEUTRAL, marginTop: 8 }}>
                Couverture finale : {Math.round(coverage * 100)}%
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={buttonSecondary}>← Retour à l'import</button>
        <button
          disabled={!taxo || !psycho}
          onClick={() => onValidate({ taxo: taxo.categories, psycho: psycho.profiles })}
          style={{ ...buttonPrimary, opacity: taxo && psycho ? 1 : 0.45, cursor: taxo && psycho ? "pointer" : "not-allowed" }}
        >
          Valider et lancer l'analyse →
        </button>
      </div>
    </div>
  );
}
