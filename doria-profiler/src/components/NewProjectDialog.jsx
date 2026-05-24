// Dialogue de création d'un nouveau projet.
// Deux champs obligatoires : nom + catégorie (existante ou nouvelle).
// Une fois validé, l'utilisateur entre dans le flux import → découverte → ...
import React, { useState, useEffect } from "react";
import { listCategories, checkDbReady } from "../api/projects.js";
import { logInfo, logErr } from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

export default function NewProjectDialog({ open, onClose, onStart }) {
  const [dbReady, setDbReady] = useState(null);
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName("");
    setSelectedCategoryId("");
    setNewCategoryName("");
    // Défaut : nom horodaté
    const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
    setName(`Projet ${ts}`);
    (async () => {
      const ready = await checkDbReady();
      setDbReady(ready);
      if (ready) {
        try {
          const r = await listCategories();
          setCategories(r?.categories || []);
        } catch (e) {
          logErr(`[new-project] Catégories : ${e.message}`);
        }
      }
    })();
  }, [open]);

  function handleStart() {
    if (!name.trim()) { setError("Nom du projet requis"); return; }
    const categoryName = newCategoryName.trim()
      || categories.find((c) => String(c.id) === selectedCategoryId)?.name
      || "";
    if (!categoryName.trim()) {
      setError("Catégorie requise (sélectionne-en une ou crée-en une nouvelle)");
      return;
    }
    logInfo(`[new-project] "${name.trim()}" · catégorie "${categoryName.trim()}"`);
    onStart({ name: name.trim(), categoryName: categoryName.trim() });
    onClose();
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
          padding: 24, width: "100%", maxWidth: 540,
        }}
      >
        <h3 style={{ margin: "0 0 4px 0", color: GOLD, fontSize: 16 }}>Nouveau projet</h3>
        <p style={{ margin: "0 0 16px 0", color: MUTED, fontSize: 12 }}>
          Nom et catégorie sont obligatoires. La catégorie sert à mutualiser les
          ancres avec les futurs projets du même domaine.
        </p>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>
              Nom du projet <span style={{ color: "#FCA5A5" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="Ex : Avis Parc Astérix été 2023"
              autoFocus
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: MUTED, display: "block", marginBottom: 4 }}>
              Catégorie <span style={{ color: "#FCA5A5" }}>*</span>
            </label>

            {dbReady === false && (
              <div style={{
                padding: 10, background: "#3B0F14", border: "1px solid #EF4444",
                borderRadius: 8, color: "#FCA5A5", fontSize: 12, marginBottom: 8,
              }}>
                ⚠ Base injoignable. Seule la création d'une nouvelle catégorie est possible
                (elle sera enregistrée à la première sauvegarde du projet).
              </div>
            )}

            {dbReady === true && categories.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>Sélectionner une existante :</div>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => { setSelectedCategoryId(e.target.value); if (e.target.value) setNewCategoryName(""); }}
                  style={{ ...inputStyle, cursor: "pointer", marginBottom: 8 }}
                  disabled={!!newCategoryName}
                >
                  <option value="">— choisir —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.clusters_count} clusters · {c.anchors_count} ancres · {c.projects_count} projets)
                    </option>
                  ))}
                </select>
              </>
            )}

            <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>
              {categories.length > 0 ? "… ou créer une nouvelle :" : "Créer une nouvelle :"}
            </div>
            <input
              value={newCategoryName}
              onChange={(e) => { setNewCategoryName(e.target.value); if (e.target.value) setSelectedCategoryId(""); }}
              style={inputStyle}
              placeholder="Ex : Parc d'attractions"
              disabled={!!selectedCategoryId}
            />
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={buttonSecondary}>Annuler</button>
          <button onClick={handleStart} style={buttonPrimary}>
            Démarrer le projet →
          </button>
        </div>
      </div>
    </div>
  );
}
