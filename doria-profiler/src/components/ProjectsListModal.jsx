// Modal listant les projets sauvegardés en base.
// Actions par projet : Ouvrir (recharge l'état complet) · Supprimer.
import React, { useState, useEffect } from "react";
import { listProjects, getProject, deleteProject, checkDbReady } from "../api/projects.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  panelStyle, buttonPrimary, buttonSecondary,
} from "../lib/theme.js";

export default function ProjectsListModal({ open, onClose, onOpen }) {
  const [dbReady, setDbReady] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    setError(null);
    try {
      const r = await listProjects();
      setProjects(r?.projects || []);
    } catch (e) {
      setError(`Impossible de charger les projets : ${e.message}`);
    }
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (ready) refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleOpen(id) {
    setLoading(true); setError(null);
    try {
      logInfo(`[db] Ouverture projet #${id}…`);
      const project = await getProject(id);
      logOk(`[db] Projet "${project.name}" chargé (${(project.verbatims || []).length} verbatims)`);
      onOpen(project);
      onClose();
    } catch (e) {
      logErr(`[db] Échec ouverture projet : ${e.message}`);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Supprimer définitivement le projet « ${name} » ?\nLes verbatims et classifications associés seront perdus.`)) return;
    setLoading(true); setError(null);
    try {
      await deleteProject(id);
      logOk(`[db] Projet #${id} supprimé`);
      refresh();
    } catch (e) {
      logErr(`[db] Échec suppression : ${e.message}`);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: 24, width: "100%", maxWidth: 760, maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: GOLD, fontSize: 16 }}>Mes projets sauvegardés</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 20 }}>×</button>
        </div>

        {dbReady === null && (
          <div style={{ color: MUTED, fontSize: 12 }}>Vérification de la base…</div>
        )}
        {dbReady === false && (
          <div style={{
            padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 12,
          }}>
            ⚠ Base de données injoignable.
          </div>
        )}
        {dbReady === true && projects.length === 0 && (
          <div style={{ padding: 24, color: MUTED, fontSize: 13, textAlign: "center" }}>
            Aucun projet sauvegardé.<br />
            Sauvegarde un premier projet via le bouton 💾 du header.
          </div>
        )}

        {dbReady === true && projects.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {projects.map((p) => (
              <div key={p.id} style={{
                background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10,
                padding: 12, display: "grid", gap: 6,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>#{p.id}</span>
                      {p.category_name && (
                        <span style={{ color: TEAL }}>📚 {p.category_name}</span>
                      )}
                      <span>{p.verbatims_count} verbatims</span>
                      <span style={{
                        color: p.status === "classified" ? POS : ACCENT,
                      }}>
                        {p.status === "classified" ? "✓ classé" : p.status === "draft" ? "brouillon" : p.status}
                      </span>
                      {p.mode && <span>mode {p.mode}</span>}
                      <span>maj {new Date(p.updated_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                    {p.contexte && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 4, fontStyle: "italic" }}>
                        {String(p.contexte).slice(0, 140)}{p.contexte.length > 140 ? "…" : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleOpen(p.id)}
                      disabled={loading}
                      style={{ ...buttonPrimary, padding: "6px 12px", fontSize: 12 }}
                    >
                      Ouvrir
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
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
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 12, padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12,
          }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}
