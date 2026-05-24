// DORIA Profiler v3.0 — Module Verbatim MVP
// State machine : import → calibrate → analyse → results
// Persistance via localStorage (tout sauf le fichier brut)
import React, { useState, useEffect } from "react";
import PhaseHome from "./components/PhaseHome.jsx";
import PhaseImport from "./components/PhaseImport.jsx";
import PhaseDiscover from "./components/PhaseDiscover.jsx";
import PhaseCalibrate from "./components/PhaseCalibrate.jsx";
import PhaseAnalyse from "./components/PhaseAnalyse.jsx";
import PhaseAnchors from "./components/PhaseAnchors.jsx";
import PhaseClassify from "./components/PhaseClassify.jsx";
import PhaseResults from "./components/PhaseResults.jsx";
import SaveProjectModal from "./components/SaveProjectModal.jsx";
import ProjectsListModal from "./components/ProjectsListModal.jsx";
import CategoriesManagerModal from "./components/CategoriesManagerModal.jsx";
import { getProject } from "./api/projects.js";
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
  const [phase, setPhase] = useState("home");
  const [mode, setMode] = useState("llm"); // 'llm' | 'embed' — choisi à la fin de Découverte
  const [items, setItems] = useState([]);          // items après mapping CSV
  const [enriched, setEnriched] = useState([]);    // items après analyse LLM
  const [taxo, setTaxo] = useState(null);
  const [psycho, setPsycho] = useState(null);
  const [contexte, setContexte] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Ouvre un projet depuis son ID (utilisé par les modals)
  async function openProjectById(id) {
    try {
      const project = await getProject(id);
      loadProjectFromDb(project);
    } catch (e) {
      alert(`Impossible d'ouvrir le projet : ${e.message}`);
    }
  }

  // ─── Hydratation d'un projet venant de la DB → reconstruit l'état runtime ───
  function loadProjectFromDb(project) {
    // Items = verbatims bruts (sans classification)
    const dbItems = (project.verbatims || []).map((v, i) => ({
      id: v.external_id || String(v.id),
      verbatim: v.text || "",
      ...(v.metadata || {}),
      _dbId: v.id,
    }));
    // Enriched = items + leurs classifications agrégées en multi-label
    const enrichedItems = dbItems.map((it, i) => {
      const v = project.verbatims[i];
      const cls = v.classifications || [];
      const primary = cls[0] || null;
      return {
        ...it,
        idx: i,
        category: primary?.cluster_label || "UNSURE",
        subCategory: primary?.subcluster_label || null,
        confidence: primary?.confidence_cluster || 0,
        confidence_cluster: primary?.confidence_cluster || 0,
        confidence_subcluster: primary?.confidence_subcluster || 0,
        categories: cls.map((c) => ({
          cluster_id: String(c.cluster_id || ""),
          cluster_label: c.cluster_label,
          subcluster_id: c.subcluster_id ? String(c.subcluster_id) : null,
          subcluster_label: c.subcluster_label,
          confidence_cluster: c.confidence_cluster,
          confidence_subcluster: c.confidence_subcluster,
          scores: c.scores || null,
        })),
        tonality: v.metadata?.tonality || null,
        psychoProfile: v.metadata?.psychoProfile || null,
        pad: v.metadata?.pad || null,
        biais: v.metadata?.biais || [],
        motivations: v.metadata?.motivations || [],
        signaux: v.metadata?.signaux || [],
        _classifier: v.metadata?._classifier || "embed+bm25",
      };
    });

    setItems(dbItems);
    setEnriched(enrichedItems);
    setTaxo(project.taxo_snapshot || null);
    setContexte(project.contexte || "");
    setMode(project.mode || "embed");
    setSavedId(project.id);
    // Sauter directement à la phase Résultats si la classification est faite
    setPhase(enrichedItems.length > 0 ? "results" : "discover");
  }

  // Hydratation initiale depuis localStorage
  useEffect(() => {
    const saved = load("session", null);
    if (saved) {
      // Si on a quelque chose en cours (items ou taxo) on reprend, sinon on revient à l'accueil
      const hasWork = (saved.items || []).length > 0 || saved.taxo;
      setPhase(hasWork ? (saved.phase || "home") : "home");
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
    // Quand on est déjà à l'accueil, pas besoin de confirmer
    if (phase !== "home") {
      const hasWork = items.length > 0 || taxo;
      if (hasWork && !confirm("Quitter le projet en cours et retourner à l'accueil ?\n(Sauvegarde-le d'abord en base si tu veux le retrouver plus tard.)")) return;
    }
    clearAll();
    setPhase("home");
    setMode("llm");
    setItems([]);
    setEnriched([]);
    setTaxo(null);
    setPsycho(null);
    setContexte("");
    setSavedId(null);
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
        {phase !== "home" && (
          <PhaseStepper phases={PHASES} phase={phase} setPhase={setPhase} canJump={{
            import: true,
            discover: items.length > 0,
            calibrate: items.length > 0 && !!taxo,
            analyse: !!taxo && !!psycho,
            anchors: items.length > 0 && !!taxo,
            classify: items.length > 0 && !!taxo && (taxo.categories || []).some((c) => c.anchors?.length),
            results: enriched.length > 0,
          }} />
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {MOCK_AI && (
            <span style={{ fontSize: 10, color: ACCENT, padding: "4px 8px", background: "rgba(168,85,247,0.1)", border: `1px solid ${ACCENT}`, borderRadius: 12 }}>
              MODE DÉMO
            </span>
          )}
          {savedId && (
            <span style={{ fontSize: 10, color: POS, padding: "4px 8px" }}>
              ✓ id {savedId}
            </span>
          )}
          {/* Gestion des catégories */}
          <button
            onClick={() => setCategoriesOpen(true)}
            style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 11 }}
            title="Gérer les catégories : créer, renommer, supprimer, voir les projets associés"
          >
            🗂️ Catégories
          </button>
          {/* Liste des projets DB */}
          <button
            onClick={() => setProjectsOpen(true)}
            style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 11 }}
            title="Lister, ouvrir ou supprimer les projets sauvegardés en base"
          >
            📂 Mes projets
          </button>
          {/* Sauvegarde accessible depuis n'importe quelle phase, dès qu'il y a quelque chose à persister */}
          <button
            onClick={() => setSaveOpen(true)}
            disabled={items.length === 0 && !taxo}
            title={items.length === 0 && !taxo ? "Rien à sauvegarder pour le moment" : "Sauvegarder le projet en base"}
            style={{
              ...buttonSecondary,
              padding: "6px 12px",
              fontSize: 11,
              opacity: items.length === 0 && !taxo ? 0.4 : 1,
              cursor: items.length === 0 && !taxo ? "not-allowed" : "pointer",
            }}
          >
            💾 Sauvegarder
          </button>
          <button onClick={reset} style={{ ...buttonSecondary, padding: "6px 12px", fontSize: 11 }}>
            🏠 Accueil
          </button>
        </div>
      </header>

      <SaveProjectModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSaved={(r) => setSavedId(r.id)}
        taxo={taxo}
        enriched={enriched.length > 0 ? enriched : items}
        contexte={contexte}
        mode={mode}
        stats={null}
      />
      <ProjectsListModal
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        onOpen={loadProjectFromDb}
      />
      <CategoriesManagerModal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        onOpenProject={openProjectById}
      />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {phase === "home" && (
          <PhaseHome
            onNewProject={() => {
              // Reset le state runtime sans confirmation (l'utilisateur démarre frais)
              clearAll();
              setItems([]);
              setEnriched([]);
              setTaxo(null);
              setPsycho(null);
              setContexte("");
              setSavedId(null);
              setMode("llm");
              setPhase("import");
            }}
            onLoadProject={(project) => loadProjectFromDb(project)}
            onOpenCategories={() => setCategoriesOpen(true)}
          />
        )}
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
