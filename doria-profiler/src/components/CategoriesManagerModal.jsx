// Modal de gestion des catégories — CRUD complet.
// Liste : nom, # clusters / sous-clusters / ancres / projets.
// Détail (déroulant) : arbre clusters → sous-clusters, liste des projets associés.
// Actions : créer · renommer · éditer description · supprimer (cascade).
import React, { useState, useEffect } from "react";
import {
  listCategories, getCategory, getCategoryProjects,
  createCategory, updateCategory, deleteCategory, checkDbReady,
} from "../api/projects.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG,
  buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

export default function CategoriesManagerModal({ open, onClose, onOpenProject }) {
  const [dbReady, setDbReady] = useState(null);
  const [categories, setCategories] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null); // { clusters, projects }
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    setError(null);
    try {
      const r = await listCategories();
      setCategories(r?.categories || []);
    } catch (e) {
      setError(`Impossible de charger les catégories : ${e.message}`);
    }
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setExpandedId(null);
    setExpandedDetail(null);
    setEditingId(null);
    setShowCreate(false);
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (ready) refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function expand(id) {
    if (expandedId === id) {
      setExpandedId(null); setExpandedDetail(null); return;
    }
    setExpandedId(id); setExpandedDetail(null);
    try {
      const [cat, projs] = await Promise.all([
        getCategory(id),
        getCategoryProjects(id),
      ]);
      setExpandedDetail({
        clusters: cat?.clusters || [],
        projects: projs?.projects || [],
      });
    } catch (e) {
      setError(`Erreur chargement détails : ${e.message}`);
    }
  }

  function startEdit(c) {
    setEditingId(c.id); setEditName(c.name); setEditDesc(c.description || "");
  }
  async function saveEdit() {
    if (!editName.trim()) { setError("Nom requis"); return; }
    setLoading(true); setError(null);
    try {
      await updateCategory(editingId, { name: editName.trim(), description: editDesc.trim() || null });
      logOk(`[db] Catégorie #${editingId} mise à jour`);
      setEditingId(null);
      refresh();
    } catch (e) {
      logErr(`[db] PATCH catégorie : ${e.message}`);
      setError(e.message);
    } finally { setLoading(false); }
  }

  async function handleCreate() {
    if (!newName.trim()) { setError("Nom requis"); return; }
    setLoading(true); setError(null);
    try {
      await createCategory({ name: newName.trim(), description: newDesc.trim() || null });
      logOk(`[db] Catégorie "${newName.trim()}" créée`);
      setNewName(""); setNewDesc(""); setShowCreate(false);
      refresh();
    } catch (e) {
      logErr(`[db] POST catégorie : ${e.message}`);
      setError(e.message);
    } finally { setLoading(false); }
  }

  async function handleDelete(c) {
    if (!confirm(
      `Supprimer définitivement la catégorie « ${c.name} » ?\n\n` +
      `• ${c.clusters_count} clusters\n` +
      `• ${c.subclusters_count} sous-clusters\n` +
      `• ${c.anchors_count} ancres\n` +
      `• ${c.projects_count} projet(s)\n\n` +
      `TOUS les projets associés ET leurs verbatims/classifications seront perdus.`,
    )) return;
    setLoading(true); setError(null);
    try {
      await deleteCategory(c.id);
      logOk(`[db] Catégorie #${c.id} supprimée`);
      refresh();
    } catch (e) {
      logErr(`[db] DELETE catégorie : ${e.message}`);
      setError(e.message);
    } finally { setLoading(false); }
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
          padding: 24, width: "100%", maxWidth: 880, maxHeight: "88vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: GOLD, fontSize: 16 }}>Gestion des catégories</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 20 }}>×</button>
        </div>

        {dbReady === false && (
          <div style={{
            padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 12,
          }}>
            ⚠ Base de données injoignable.
          </div>
        )}

        {/* ── Création ─────────────────────────────────────────────── */}
        {dbReady === true && (
          <div style={{ marginBottom: 16 }}>
            {!showCreate ? (
              <button onClick={() => setShowCreate(true)} style={buttonPrimary}>
                + Nouvelle catégorie
              </button>
            ) : (
              <div style={{
                background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10,
                padding: 12, display: "grid", gap: 8,
              }}>
                <div style={{ fontSize: 12, color: TEAL, fontWeight: 600 }}>Nouvelle catégorie</div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nom (ex : Parc d'attractions)"
                  style={inputStyle}
                  autoFocus
                />
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Description (facultatif)"
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handleCreate} disabled={loading} style={buttonPrimary}>Créer</button>
                  <button onClick={() => { setShowCreate(false); setNewName(""); setNewDesc(""); }} style={buttonSecondary}>Annuler</button>
                </div>
              </div>
            )}
          </div>
        )}

        {dbReady === true && categories.length === 0 && !showCreate && (
          <div style={{ padding: 24, color: MUTED, fontSize: 13, textAlign: "center" }}>
            Aucune catégorie en base.<br />
            Crée-en une, ou sauvegarde un premier projet avec une catégorie.
          </div>
        )}

        {/* ── Liste des catégories ─────────────────────────────────── */}
        {dbReady === true && categories.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {categories.map((c) => (
              <div key={c.id} style={{
                background: PANEL_2, border: `1px solid ${expandedId === c.id ? GOLD : BORDER}`,
                borderRadius: 10, padding: 12,
              }}>
                {editingId === c.id ? (
                  // ─── Mode édition ─────────────────────────────────
                  <div style={{ display: "grid", gap: 8 }}>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" style={inputStyle} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={saveEdit} disabled={loading} style={buttonPrimary}>Enregistrer</button>
                      <button onClick={() => setEditingId(null)} style={buttonSecondary}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  // ─── Mode lecture ─────────────────────────────────
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div
                        onClick={() => expand(c.id)}
                        style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
                          {expandedId === c.id ? "▼" : "▶"} {c.name}
                        </div>
                        <div style={{ fontSize: 11, color: MUTED, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <span><b style={{ color: TEXT }}>{c.clusters_count}</b> clusters</span>
                          <span><b style={{ color: TEXT }}>{c.subclusters_count}</b> sous-clusters</span>
                          <span style={{ color: TEAL }}><b>{c.anchors_count}</b> ancres</span>
                          <span style={{ color: ACCENT }}><b>{c.projects_count}</b> projet{c.projects_count > 1 ? "s" : ""}</span>
                        </div>
                        {c.description && (
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 4, fontStyle: "italic" }}>
                            {c.description}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => startEdit(c)} style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11 }}>
                          Renommer
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          style={{
                            ...buttonSecondary, padding: "4px 10px", fontSize: 11,
                            color: "#FCA5A5", borderColor: "#EF4444",
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>

                    {/* ── Détails déroulés ── */}
                    {expandedId === c.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
                        {!expandedDetail && (
                          <div style={{ fontSize: 11, color: MUTED }}>Chargement…</div>
                        )}
                        {expandedDetail && (
                          <>
                            {/* Arbre clusters */}
                            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                              Arbre des clusters
                            </div>
                            {expandedDetail.clusters.length === 0 ? (
                              <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>
                                Aucun cluster. La catégorie sera enrichie quand un projet sera sauvegardé.
                              </div>
                            ) : (
                              <div style={{ display: "grid", gap: 4, marginBottom: 12, fontSize: 12 }}>
                                {expandedDetail.clusters.map((cl) => (
                                  <div key={cl.id} style={{ padding: "6px 10px", background: "#06101C", borderRadius: 6 }}>
                                    <div style={{ color: GOLD }}>
                                      📁 {cl.name}
                                      {(cl.anchors?.length > 0) && (
                                        <span style={{ marginLeft: 8, fontSize: 10, color: TEAL }}>
                                          {cl.anchors.length} ancres
                                        </span>
                                      )}
                                    </div>
                                    {(cl.subclusters || []).length > 0 && (
                                      <div style={{ paddingLeft: 16, marginTop: 2, fontSize: 11, color: MUTED }}>
                                        {cl.subclusters.map((s) => (
                                          <div key={s.id}>
                                            └ {s.name}
                                            {(s.anchors?.length > 0) && (
                                              <span style={{ marginLeft: 6, color: TEAL }}>({s.anchors.length})</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Liste des projets associés */}
                            <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                              Projets dans cette catégorie ({expandedDetail.projects.length})
                            </div>
                            {expandedDetail.projects.length === 0 ? (
                              <div style={{ fontSize: 11, color: MUTED }}>Aucun projet pour le moment.</div>
                            ) : (
                              <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
                                {expandedDetail.projects.map((p) => (
                                  <div key={p.id} style={{
                                    padding: "6px 10px", background: "#06101C", borderRadius: 6,
                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                  }}>
                                    <div>
                                      <span style={{ color: TEXT, fontWeight: 600 }}>{p.name}</span>
                                      <span style={{ marginLeft: 8, color: MUTED }}>
                                        · {p.verbatims_count} verbatims
                                        · {p.status === "classified" ? "✓ classé" : p.status}
                                      </span>
                                    </div>
                                    {onOpenProject && (
                                      <button
                                        onClick={() => { onOpenProject(p.id); onClose(); }}
                                        style={{ ...buttonSecondary, padding: "2px 8px", fontSize: 10 }}
                                      >
                                        Ouvrir
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
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
