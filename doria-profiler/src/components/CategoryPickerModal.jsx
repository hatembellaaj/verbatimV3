// Modal de sélection d'une catégorie depuis la base.
// Liste les catégories existantes (avec leur nombre de clusters/projets/ancres)
// et permet d'en charger une → la taxo + les ancres sont préchargées dans
// PhaseDiscover (l'utilisateur peut ensuite éditer avant de valider).
import React, { useState, useEffect } from "react";
import { listCategories, getCategoryTaxo, checkDbReady } from "../api/projects.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT,
  panelStyle, buttonPrimary, buttonSecondary,
} from "../lib/theme.js";

export default function CategoryPickerModal({ open, onClose, onLoaded }) {
  const [dbReady, setDbReady] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setSelectedId(null);
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (!ready) return;
      try {
        const r = await listCategories();
        setCategories(r?.categories || []);
      } catch (e) {
        setError(`Impossible de charger les catégories : ${e.message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleLoad() {
    if (!selectedId) { setError("Sélectionne une catégorie"); return; }
    setLoading(true); setError(null);
    try {
      logInfo(`[db] Chargement catégorie #${selectedId}…`);
      const r = await getCategoryTaxo(selectedId);
      const taxo = r?.taxo;
      if (!taxo?.categories?.length) {
        throw new Error("La catégorie ne contient aucun cluster");
      }
      const totalAnchors = taxo.categories.reduce(
        (s, c) => s + (c.anchors?.length || 0)
                    + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0),
        0,
      );
      logOk(`[db] Catégorie "${r.category.name}" chargée : ${taxo.categories.length} clusters, ${totalAnchors} ancres`);
      onLoaded({
        ...taxo,
        anchorsVersion: totalAnchors > 0 ? `db-${r.category.id}-${Date.now()}` : null,
        _categoryId: r.category.id,
        _categoryName: r.category.name,
      });
      onClose();
    } catch (e) {
      logErr(`[db] Échec chargement catégorie : ${e.message}`);
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
          padding: 24, width: "100%", maxWidth: 560,
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", color: GOLD, fontSize: 16 }}>
          Charger une catégorie depuis la base
        </h3>

        {dbReady === null && (
          <div style={{ color: MUTED, fontSize: 12, marginBottom: 12 }}>Vérification de la base…</div>
        )}
        {dbReady === false && (
          <div style={{
            padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 12,
          }}>
            ⚠ Base de données injoignable. Le service <code>db</code> tourne-t-il ?
          </div>
        )}
        {dbReady === true && categories.length === 0 && (
          <div style={{ padding: 10, color: MUTED, fontSize: 12, marginBottom: 12 }}>
            Aucune catégorie en base pour le moment. Sauvegarde un premier projet
            (avec catégorie) pour pouvoir le réutiliser ici.
          </div>
        )}

        {dbReady === true && categories.length > 0 && (
          <div style={{ display: "grid", gap: 8, maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
            {categories.map((c) => (
              <label key={c.id} style={{
                display: "block", cursor: "pointer", padding: 10,
                background: selectedId === c.id ? "rgba(212,175,55,0.12)" : PANEL_2,
                border: `1px solid ${selectedId === c.id ? GOLD : BORDER}`,
                borderRadius: 8,
              }}>
                <input
                  type="radio"
                  name="category"
                  checked={selectedId === c.id}
                  onChange={() => setSelectedId(c.id)}
                  style={{ marginRight: 8 }}
                />
                <span style={{ fontWeight: 600, color: TEXT }}>{c.name}</span>
                <div style={{ marginLeft: 22, marginTop: 4, fontSize: 11, color: MUTED }}>
                  {c.clusters_count} clusters · {c.projects_count} projet{c.projects_count > 1 ? "s" : ""}
                  {c.description && <div style={{ marginTop: 2, fontStyle: "italic" }}>{c.description}</div>}
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div style={{
            padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 12,
          }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={buttonSecondary} disabled={loading}>Annuler</button>
          <button
            onClick={handleLoad}
            style={{ ...buttonPrimary, opacity: loading || !selectedId ? 0.45 : 1 }}
            disabled={loading || !selectedId || dbReady === false}
          >
            {loading ? "Chargement…" : "Charger cette catégorie"}
          </button>
        </div>
      </div>
    </div>
  );
}
