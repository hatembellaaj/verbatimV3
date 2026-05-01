// Phase 1 — Import CSV + Auto-mapping
// spec § I.2 (Ingestion) + III.1 (Stats descriptives)
import React, { useState, useRef } from "react";
import { parseCSVFile, autoMap, applyMapping, describeCorpus, DORIA_FIELDS } from "../lib/csv.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const FIELD_LABELS = {
  verbatim: "Verbatim (obligatoire)",
  note: "Note / Score",
  date: "Date",
  profil: "Profil / Segment",
  source: "Source / Plateforme",
  score_fidelite: "Score fidélité",
  id_externe: "ID externe",
};

export default function PhaseImport({ onValidate }) {
  const fileInput = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null); // { rows, fields, delimiter }
  const [mapping, setMapping] = useState({});
  const [contexte, setContexte] = useState("");
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);

  async function handleFile(file) {
    setError(null);
    setParsing(true);
    try {
      const result = await parseCSVFile(file);
      setParsed(result);
      const auto = autoMap(result.fields);
      setMapping(auto);
      // Pré-calcul stats
      const mapped = applyMapping(result.rows, auto);
      setItems(mapped);
      setStats(describeCorpus(mapped));
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  }

  function updateMapping(field, col) {
    const next = { ...mapping, [field]: col || null };
    if (!col) delete next[field];
    setMapping(next);
    if (parsed) {
      const mapped = applyMapping(parsed.rows, next);
      setItems(mapped);
      setStats(describeCorpus(mapped));
    }
  }

  const canValidate = !!mapping.verbatim && items.length >= 50;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>Phase 1 — Import du corpus</h2>
        <p style={{ margin: "0 0 16px 0", color: MUTED, fontSize: 13 }}>
          Charge un fichier CSV (séparateur auto-détecté : virgule, point-virgule ou tabulation). L'auto-mapping
          détecte les colonnes Doria. Tu pourras ajuster manuellement si besoin.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInput.current?.click()}
          style={{
            border: `2px dashed ${BORDER}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            cursor: "pointer",
            background: PANEL_2,
            color: MUTED,
          }}
        >
          {parsing ? (
            <span>Parsing en cours…</span>
          ) : parsed ? (
            <span style={{ color: TEXT }}>
              ✓ {parsed.rows.length} lignes, {parsed.fields.length} colonnes (délim. <code>{parsed.delimiter === "\t" ? "TAB" : parsed.delimiter}</code>)
              <br /><small style={{ color: MUTED }}>Cliquer pour remplacer</small>
            </span>
          ) : (
            <span>
              📁 Glisser-déposer un CSV ici ou cliquer pour parcourir
              <br /><small>UTF-8 recommandé</small>
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: 12, background: "#3B0F14", border: "1px solid #EF4444", borderRadius: 8, color: "#FCA5A5", fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {parsed && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>Mapping des colonnes</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
            {DORIA_FIELDS.map((f) => (
              <div key={f}>
                <label style={{ fontSize: 12, color: MUTED, display: "block", marginBottom: 4 }}>
                  {FIELD_LABELS[f]}
                </label>
                <select
                  value={mapping[f] || ""}
                  onChange={(e) => updateMapping(f, e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="">— non mappé —</option>
                  {parsed.fields.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>Statistiques descriptives</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
            <Stat label="Total" value={stats.total} />
            <Stat label="Exploitables" value={stats.exploitable} hint={`${stats.pctExploitable}%`} />
            <Stat label="Avec note" value={stats.withNote} hint={`${stats.pctWithNote}%`} />
            <Stat label="Avec date" value={stats.withDate} hint={`${stats.pctWithDate}%`} />
            <Stat label="Avec profil" value={stats.withProfil} hint={`${stats.pctWithProfil}%`} />
            <Stat label="Note moyenne" value={stats.avgNote ?? "—"} />
            <Stat label="Long. moy." value={`${stats.avgLen} mots`} />
          </div>
          {stats.total < 100 && (
            <div style={{ marginTop: 12, padding: 10, background: "#332100", border: `1px solid ${GOLD}`, borderRadius: 8, fontSize: 12, color: "#FBBF24" }}>
              ⚠ Corpus &lt; 100 verbatims : la calibration sera approximative. Recommandé : 500+ verbatims.
            </div>
          )}

          {/* ─── Aperçu des 5 premiers verbatims — vérification visuelle du mapping ─── */}
          {items.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Aperçu — 5 premiers verbatims (vérifie que c'est bien du texte de feedback)
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {items.slice(0, 5).map((it, i) => (
                  <div key={i} style={{
                    background: "#06101C",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 6,
                    padding: 10,
                    fontSize: 12,
                    color: TEXT,
                    lineHeight: 1.5,
                  }}>
                    <span style={{ color: MUTED, marginRight: 8 }}>#{i + 1}</span>
                    {String(it.verbatim || "").slice(0, 280)}
                    {String(it.verbatim || "").length > 280 ? "…" : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {parsed && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 8px 0", color: TEAL, fontSize: 15 }}>Contexte sectoriel <span style={{ color: MUTED, fontWeight: 400 }}>(optionnel)</span></h3>
          <p style={{ margin: "0 0 8px 0", color: MUTED, fontSize: 12 }}>
            Quelques mots pour orienter Claude : secteur, type d'enseigne, période, particularités. Ex : « chaîne de boulangeries en France, période avril 2024-2025 ».
          </p>
          <textarea
            value={contexte}
            onChange={(e) => setContexte(e.target.value)}
            rows={2}
            placeholder="Décris brièvement le secteur ou le contexte…"
            style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>
      )}

      {parsed && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            disabled={!canValidate}
            onClick={() => onValidate({ items, mapping, contexte, stats })}
            style={{
              ...buttonPrimary,
              opacity: canValidate ? 1 : 0.45,
              cursor: canValidate ? "pointer" : "not-allowed",
            }}
          >
            Valider et passer à la calibration →
          </button>
        </div>
      )}
      {parsed && !canValidate && (
        <p style={{ margin: 0, color: MUTED, fontSize: 12, textAlign: "right" }}>
          {!mapping.verbatim ? "Mappe au moins la colonne Verbatim." : `Au moins 50 verbatims exploitables requis (actuellement ${items.length}).`}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, color: TEXT, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: ACCENT, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
