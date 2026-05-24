// Écran d'accueil — point d'entrée de DORIA.
// Deux actions principales :
//   1. Nouveau projet → lance le flux import → découverte → … → résultats
//   2. Ouvrir un projet existant → reconstruit l'état runtime depuis la DB
// Affiche aussi un raccourci vers la gestion des catégories.
import React, { useState, useEffect } from "react";
import {
  listProjects, listCategories, getProject, deleteProject, checkDbReady,
} from "../api/projects.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  panelStyle, buttonPrimary, buttonSecondary,
} from "../lib/theme.js";

export default function PhaseHome({ onNewProject, onLoadProject, onOpenCategories }) {
  const [dbReady, setDbReady] = useState(null);
  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    setError(null);
    try {
      const [pr, cr] = await Promise.all([listProjects(), listCategories()]);
      setProjects(pr?.projects || []);
      setCategories(cr?.categories || []);
    } catch (e) {
      setError(`Impossible de charger les données : ${e.message}`);
    }
  }

  useEffect(() => {
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (ready) refresh();
    })();
  }, []);

  async function handleOpen(id) {
    setLoading(true); setError(null);
    try {
      logInfo(`[home] Ouverture projet #${id}…`);
      const project = await getProject(id);
      logOk(`[home] Projet "${project.name}" chargé`);
      onLoadProject(project);
    } catch (e) {
      logErr(`[home] Échec ouverture : ${e.message}`);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(p) {
    if (!confirm(`Supprimer définitivement le projet « ${p.name} » ?\nLes verbatims et classifications associés seront perdus.`)) return;
    setLoading(true);
    try {
      await deleteProject(p.id);
      logOk(`[home] Projet #${p.id} supprimé`);
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const totalVerbatims = projects.reduce((s, p) => s + (p.verbatims_count || 0), 0);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* ── Hero — création nouveau projet ─────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, rgba(212,175,55,0.08), rgba(34,211,238,0.05))`,
        border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32,
        textAlign: "center",
      }}>
        <h1 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 28, fontWeight: 700 }}>
          Bienvenue dans DORIA Profiler
        </h1>
        <p style={{ margin: "0 0 24px 0", color: MUTED, fontSize: 14 }}>
          Importe un CSV pour démarrer un nouveau projet de classification de verbatims,<br />
          ou reprends un projet existant.
        </p>
        <button onClick={onNewProject} style={{
          ...buttonPrimary, padding: "12px 28px", fontSize: 14,
        }}>
          + Nouveau projet
        </button>
      </div>

      {/* ── Stats globales si DB OK ─────────────────────────────────────── */}
      {dbReady === true && (projects.length > 0 || categories.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Stat label="Catégories" value={categories.length} />
          <Stat label="Projets sauvegardés" value={projects.length} />
          <Stat label="Verbatims classés" value={totalVerbatims} />
          <Stat
            label="Ancres mutualisées"
            value={categories.reduce((s, c) => s + (c.anchors_count || 0), 0)}
            color={TEAL}
          />
        </div>
      )}

      {/* ── Erreurs / DB indispo ────────────────────────────────────────── */}
      {dbReady === false && (
        <div style={{
          padding: 14, background: "#3B0F14", border: "1px solid #EF4444",
          borderRadius: 10, color: "#FCA5A5", fontSize: 13,
        }}>
          ⚠ Base de données injoignable. Tu peux créer un nouveau projet, mais
          la sauvegarde et l'ouverture de projets existants ne seront pas disponibles.
        </div>
      )}

      {/* ── Catégories disponibles (résumé + lien) ──────────────────────── */}
      {dbReady === true && categories.length > 0 && (
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>
              Catégories disponibles <span style={{ color: MUTED, fontWeight: 400, fontSize: 12 }}>({categories.length})</span>
            </h3>
            <button onClick={onOpenCategories} style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11 }}>
              Gérer →
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {categories.map((c) => (
              <div key={c.id} style={{
                padding: "6px 12px", background: PANEL_2, border: `1px solid ${BORDER}`,
                borderRadius: 999, fontSize: 11, color: TEXT, display: "flex", gap: 8, alignItems: "center",
              }}>
                <span style={{ color: GOLD }}>📚 {c.name}</span>
                <span style={{ color: MUTED }}>{c.projects_count}p · {c.anchors_count}a</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Liste des projets ───────────────────────────────────────────── */}
      <div style={panelStyle}>
        <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>
          Mes projets
          {dbReady === true && (
            <span style={{ color: MUTED, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
              ({projects.length})
            </span>
          )}
        </h3>

        {dbReady === null && (
          <div style={{ color: MUTED, fontSize: 12 }}>Chargement…</div>
        )}
        {dbReady === true && projects.length === 0 && (
          <div style={{ padding: 24, color: MUTED, fontSize: 13, textAlign: "center" }}>
            Aucun projet sauvegardé pour le moment.<br />
            Clique sur <b style={{ color: GOLD }}>+ Nouveau projet</b> ci-dessus pour commencer.
          </div>
        )}
        {dbReady === true && projects.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {projects.map((p) => (
              <div key={p.id} style={{
                background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10,
                padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
              }}>
                <div
                  onClick={() => handleOpen(p.id)}
                  style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {p.category_name && (
                      <span style={{ color: TEAL }}>📚 {p.category_name}</span>
                    )}
                    <span>{p.verbatims_count} verbatims</span>
                    <span style={{ color: p.status === "classified" ? POS : ACCENT }}>
                      {p.status === "classified" ? "✓ classé" : p.status === "draft" ? "brouillon" : p.status}
                    </span>
                    {p.mode && <span>mode {p.mode}</span>}
                    <span>maj {new Date(p.updated_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => handleOpen(p.id)} disabled={loading} style={{ ...buttonPrimary, padding: "6px 12px", fontSize: 12 }}>
                    Ouvrir
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    disabled={loading}
                    style={{
                      ...buttonSecondary, padding: "6px 12px", fontSize: 12,
                      color: "#FCA5A5", borderColor: "#EF4444",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, color: color || TEXT, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
