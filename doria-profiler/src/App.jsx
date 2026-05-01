// DORIA Profiler v3.0 — Module Verbatim MVP
// State machine : import → calibrate → analyse → results
// Persistance via localStorage (tout sauf le fichier brut)
import React, { useState, useEffect } from "react";
import PhaseImport from "./components/PhaseImport.jsx";
import PhaseCalibrate from "./components/PhaseCalibrate.jsx";
import PhaseAnalyse from "./components/PhaseAnalyse.jsx";
import PhaseResults from "./components/PhaseResults.jsx";
import { save, load, clearAll } from "./lib/storage.js";
import { MOCK_AI } from "./api/claude.js";
import {
  BG, PANEL, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS,
  panelStyle, buttonSecondary,
} from "./lib/theme.js";

const PHASES = ["import", "calibrate", "analyse", "results"];
const PHASE_LABELS = {
  import: "1. Import",
  calibrate: "2. Calibration",
  analyse: "3. Analyse",
  results: "4. Résultats",
};

export default function App() {
  const [phase, setPhase] = useState("import");
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
    save("session", { phase, items, enriched, taxo, psycho, contexte });
  }, [hydrated, phase, items, enriched, taxo, psycho, contexte]);

  function reset() {
    if (!confirm("Effacer toutes les données et recommencer un nouveau projet ?")) return;
    clearAll();
    setPhase("import");
    setItems([]);
    setEnriched([]);
    setTaxo(null);
    setPsycho(null);
    setContexte("");
  }

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
        <PhaseStepper phase={phase} setPhase={setPhase} canJump={{
          import: true,
          calibrate: items.length > 0,
          analyse: !!taxo && !!psycho,
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
              setPhase("calibrate");
            }}
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
        {phase === "results" && (
          <PhaseResults
            items={enriched}
            taxo={taxo}
            psycho={psycho}
            onBack={() => setPhase("analyse")}
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

function PhaseStepper({ phase, setPhase, canJump }) {
  return (
    <div style={{ display: "flex", gap: 4, fontSize: 11 }}>
      {PHASES.map((p, i) => {
        const current = phase === p;
        const reached = PHASES.indexOf(phase) >= i;
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
