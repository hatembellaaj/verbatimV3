// Modal de sauvegarde d'un projet en base.
// Demande : nom du projet + catégorie (existante via dropdown ou nouvelle).
// POST /api/projects en transaction (verbatims + classifications + taxo_snapshot).
import React, { useState, useEffect } from "react";
import {
  listCategories, createProject, buildSavePayload, checkDbReady,
} from "../api/projects.js";
import { logInfo, logOk, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, POS,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

export default function SaveProjectModal({
  open, onClose, onSaved,
  // état runtime à persister
  taxo, enriched, contexte, mode, stats,
}) {
  const [name, setName] = useState("");
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [dbReady, setDbReady] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Défaut : nom basé sur la date
    if (!name) {
      const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
      setName(`Projet ${ts}`);
    }
    // Vérif DB + chargement catégories
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (ready) {
        try {
          const r = await listCategories();
          setCategories(r?.categories || []);
        } catch (e) {
          logErr(`[save] Catégories : ${e.message}`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Nom du projet requis"); return; }
    const categoryName = newCategoryName.trim()
      || categories.find((c) => String(c.id) === selectedCategoryId)?.name
      || null;
    // Catégorie OBLIGATOIRE pour garantir l'héritage des ancres
    if (!categoryName) {
      setError("Choisis une catégorie (existante ou nouvelle). Les ancres seront alors mutualisées.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildSavePayload({
        name: name.trim(),
        categoryName,
        contexte, mode, taxo,
        enriched, stats,
      });
      // Compte total d'ancres pour log
      const totalAnchors = (taxo?.categories || []).reduce(
        (s, c) => s + (c.anchors?.length || 0)
                    + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0),
        0,
      );
      logInfo(`[save] Sauvegarde "${name}" → catégorie "${categoryName}" (${payload.verbatims.length} verbatims, ${totalAnchors} ancres mutualisées)…`);
      const result = await createProject(payload);
      logOk(`[save] Projet #${result.id} sauvegardé · ancres ajoutées au pool de la catégorie "${categoryName}" (dédup auto par texte)`);
      if (onSaved) onSaved(result);
      onClose();
    } catch (e) {
      logErr(`[save] ÉCHEC : ${e.message}`);
      setError(e.message);
    } finally {
      setSaving(false);
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
          padding: 24, width: "100%", maxWidth: 520,
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", color: GOLD, fontSize: 16 }}>Sauvegarder le projet</h3>

        {dbReady === null && (
          <div style={{ color: MUTED, fontSize: 12, marginBottom: 12 }}>Vérification de la base…</div>
        )}
        {dbReady === false && (
          <div style={{
            padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
            borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 12,
          }}>
            ⚠ Base de données injoignable. Vérifie que le container <code>db</code> tourne :
            <code style={{ display: "block", marginTop: 6, fontSize: 11 }}>
              sudo docker compose --profile prod logs --tail=20 db
            </code>
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>
              Nom du projet
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="Ex : Parc Astérix — Été 2023"
              autoFocus
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>
              Catégorie existante <span style={{ color: "#FCA5A5" }}>(obligatoire — pour mutualiser les ancres)</span>
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => { setSelectedCategoryId(e.target.value); if (e.target.value) setNewCategoryName(""); }}
              style={{ ...inputStyle, cursor: "pointer" }}
              disabled={!!newCategoryName}
            >
              <option value="">— aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.clusters_count} clusters · {c.projects_count} projets)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>
              … ou nouvelle catégorie
            </label>
            <input
              value={newCategoryName}
              onChange={(e) => { setNewCategoryName(e.target.value); if (e.target.value) setSelectedCategoryId(""); }}
              style={inputStyle}
              placeholder="Ex : Parc d'attractions"
              disabled={!!selectedCategoryId}
            />
          </div>

          <div style={{
            fontSize: 11, color: MUTED, background: PANEL_2, padding: 10,
            borderRadius: 8, border: `1px solid ${BORDER}`,
          }}>
            <div style={{ color: TEXT, marginBottom: 4 }}>À enregistrer :</div>
            <div>· {(enriched || []).length} verbatims classés</div>
            <div>· {(taxo?.categories || []).length} clusters dans la taxo (snapshot)</div>
            <div>· {(taxo?.categories || []).reduce((s, c) => s + (c.anchors?.length || 0) + Object.values(c.subAnchors || {}).reduce((ss, a) => ss + a.length, 0), 0)} <b style={{ color: TEAL }}>ancres mutualisées au niveau de la catégorie</b></div>
            <div>· mode : <code>{mode || "—"}</code></div>
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={buttonSecondary} disabled={saving}>Annuler</button>
          <button
            onClick={handleSave}
            style={{ ...buttonPrimary, opacity: saving || dbReady === false ? 0.45 : 1 }}
            disabled={saving || dbReady === false}
          >
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}
