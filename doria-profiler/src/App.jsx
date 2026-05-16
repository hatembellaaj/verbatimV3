// DORIA Profiler v3.0 — Module Verbatim MVP
// State machine : import → calibrate → analyse → results
// Persistance via localStorage (tout sauf le fichier brut)
import React, { useState, useEffect } from "react";
import PhaseImport from "./components/PhaseImport.jsx";
import PhaseDiscover from "./components/PhaseDiscover.jsx";
import PhaseCalibrate from "./components/PhaseCalibrate.jsx";
import PhaseAnalyse from "./components/PhaseAnalyse.jsx";
import PhaseAnchors from "./components/PhaseAnchors.jsx";
import PhaseClassify from "./components/PhaseClassify.jsx";
import PhaseResults from "./components/PhaseResults.jsx";
import { save, load, clearAll } from "./lib/storage.js";
import { MOCK_AI } from "./api/claude.js";
import {
  BG, PANEL, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS,
  panelStyle, buttonSecondary,
} from "./lib/theme.js";

// Deux flux possibles après "discover" :
//   LLM      : discover → calibrate → analyse → results
//   Embed    : discover → anchors → classify → results
// Le stepper affiche dynamiquement les bonnes étapes selon `mode`.
const PHASES_LLM = ["import", "discover", "calibrate", "analyse", "results"];
const PHASES_EMBED = ["import", "discover", "anchors", "classify", "results"];
const PHASE_LABELS = {
  import: "1. Import",
  discover: "2. Découverte",
  calibrate: "3. Calibration",
  analyse: "4. Analyse LLM",
  anchors: "3. Ancres",
  classify: "4. Classification",
  results: "Résultats",
};

export default function App() {
  const [phase, setPhase] = useState("import");
  const [mode, setMode] = useState("llm"); // 'llm' | 'embed' — choisi à la fin de Découverte
  const [items, setItems] = useState([]);          // items après mapping CSV
  const [enriched, setEnriched] = useState([]);    // items après analyse LLM
  const [taxo, setTaxo] = useState(null);
  const [psycho, setPsycho] = useState(null);
  const [contexte, setContexte] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Hydratation initiale depuis localStorage
  useEffect(() => {
    const saved = load("session", null);
    if (saved) {
      setPhase(saved.phase || "import");
      setMode(saved.mode || "llm");
      setItems(saved.items || []);
      setEnriched(saved.enriched || []);
      setTaxo(saved.taxo || null);
      setPsycho(saved.psycho || null);
      setContexte(saved.contexte || "");
    }
    setHydrated(true);
  }, []);

  // Persistance à chaque changement
  useEffect(() => {
    if (!hydrated) return;
    save("session", { phase, mode, items, enriched, taxo, psycho, contexte });
  }, [hydrated, phase, mode, items, enriched, taxo, psycho, contexte]);

  function reset() {
    if (!confirm("Effacer toutes les données et recommencer un nouveau projet ?")) return;
    clearAll();
    setPhase("import");
    setMode("llm");
    setItems([]);
    setEnriched([]);
    setTaxo(null);
    setPsycho(null);
    setContexte("");
  }

  const PHASES = mode === "embed" ? PHASES_EMBED : PHASES_LLM;

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontSize: 14 }}>
      <header style={{
        borderBottom: `1px solid ${BORDER}`, padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: GOLD, letterSpacing: 0.5 }}>
            DORIA <span style={{ color: TEXT }}>Profiler</span>
            <span style={{ color: MUTED, fontWeight: 400, fontSize: 11, marginLeft: 8 }}>v3.0 — Module Verbatim</span>
          </div>
        </div>
        <PhaseStepper phases={PHASES} phase={phase} setPhase={setPhase} canJump={{
          import: true,
          discover: items.length > 0,
          calibrate: items.length > 0 && !!taxo,
          analyse: !!taxo && !!psycho,
          anchors: items.length > 0 && !!taxo,
          classify: items.length > 0 && !!taxo && (taxo.categories || []).some((c) => c.anchors?.length),
          results: enriched.length > 0,
        }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {MOCK_AI && (
            <span style={{ fontSize: 10, color: ACCENT, padding: "4px 8px", background: "rgba(168,85,247,0.1)", border: `1px solid ${ACCENT}`, borderRadius: 12 }}>
              MODE DÉMO
            </span>
          )}
          <button onClick={reset} style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 11 }}>Nouveau</button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {phase === "import" && (
          <PhaseImport
            onValidate={({ items, contexte, mapping, stats }) => {
              setItems(items);
              setContexte(contexte || "");
              setPhase("discover");
            }}
          />
        )}
        {phase === "discover" && (
          <PhaseDiscover
            items={items}
            contexte={contexte}
            initialTaxo={taxo}
            onValidate={({ taxo, mode: chosenMode }) => {
              setTaxo(taxo);
              setMode(chosenMode || "llm");
              setPhase(chosenMode === "embed" ? "anchors" : "calibrate");
            }}
            onBack={() => setPhase("import")}
          />
        )}
        {phase === "anchors" && (
          <PhaseAnchors
            taxo={taxo}
            contexte={contexte}
            onTaxoUpdate={setTaxo}
            onValidate={({ taxo: validatedTaxo }) => {
              setTaxo(validatedTaxo);
              setPhase("classify");
            }}
            onBack={() => setPhase("discover")}
          />
        )}
        {phase === "calibrate" && (
          <PhaseCalibrate
            items={items}
            contexte={contexte}
            onValidate={({ taxo, psycho }) => {
              setTaxo(taxo);
              setPsycho(psycho);
              setPhase("analyse");
            }}
            onBack={() => setPhase("import")}
          />
        )}
        {phase === "analyse" && (
          <PhaseAnalyse
            items={items}
            taxo={taxo}
            psycho={psycho}
            contexte={contexte}
            initialResults={enriched.length > 0 ? enriched : null}
            onResultsChange={setEnriched}
            onValidate={({ items: enr }) => {
              setEnriched(enr);
              setPhase("results");
            }}
            onBack={() => setPhase("calibrate")}
          />
        )}
        {phase === "classify" && (
          <PhaseClassify
            items={items}
            taxo={taxo}
            contexte={contexte}
            initialResults={enriched.length > 0 ? enriched : null}
            onResultsChange={setEnriched}
            onValidate={({ items: enr }) => {
              setEnriched(enr);
              setPhase("results");
            }}
            onBack={() => setPhase("anchors")}
          />
        )}
        {phase === "results" && (
          <PhaseResults
            items={enriched}
            taxo={taxo}
            psycho={psycho}
            contexte={contexte}
            mode={mode}
            onBack={() => setPhase(mode === "embed" ? "classify" : "analyse")}
            onReset={reset}
          />
        )}
      </main>

      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "16px 24px", fontSize: 11, color: MUTED, textAlign: "center" }}>
        DORIA Profiler — Spec PROFILER® v3.0 · Couches 1+5 · BATCH_SIZE=10 · Seuil confiance 0.5
      </footer>
    </div>
  );
}

function PhaseStepper({ phases, phase, setPhase, canJump }) {
  return (
    <div style={{ display: "flex", gap: 4, fontSize: 11 }}>
      {phases.map((p, i) => {
        const current = phase === p;
        const reached = phases.indexOf(phase) >= i;
        const enabled = canJump[p];
        return (
          <button
            key={p}
            onClick={() => enabled && setPhase(p)}
            disabled={!enabled}
            style={{
              background: current ? GOLD : reached ? "rgba(212,175,55,0.1)" : "transparent",
              color: current ? "#0A1422" : reached ? GOLD : MUTED,
              border: `1px solid ${current ? GOLD : reached ? GOLD : BORDER}`,
              borderRadius: 6, padding: "6px 12px",
              cursor: enabled ? "pointer" : "not-allowed",
              opacity: enabled ? 1 : 0.4,
              fontWeight: current ? 700 : 500,
              fontSize: 11, whiteSpace: "nowrap",
            }}
          >
            {PHASE_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
