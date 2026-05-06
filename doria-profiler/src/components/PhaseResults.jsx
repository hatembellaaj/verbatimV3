// Phase 4 — Résultats — 4 onglets
// 1. Catégories (4 quadrants vol×insat) | 2. Évolution (timeline)
// 3. Profils & Psychologie (PAD radar + biais + tension map) | 4. Items bruts
import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend, ScatterChart, Scatter, ZAxis, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import { downloadCSV, parseDate, monthKey, parseJSON } from "../lib/utils.js";
import { callClaude, MOCK_AI } from "../api/claude.js";
import { promptContextChat } from "../lib/prompts.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG, NEUTRAL, CAT_COLORS,
  panelStyle, buttonPrimary, buttonSecondary, inputStyle,
} from "../lib/theme.js";

const TABS = [
  { id: "categories", label: "Catégories" },
  { id: "evolution", label: "Évolution" },
  { id: "profils", label: "Profils & Psychologie" },
  { id: "items", label: "Items bruts" },
];

export default function PhaseResults({ items, taxo, psycho, onBack, onReset }) {
  const [tab, setTab] = useState("categories");
  const [drillItem, setDrillItem] = useState(null);

  // Stats agrégées (utilisés par tous les onglets ET le chat)
  const stats = useMemo(() => buildStats(items, taxo, psycho), [items, taxo, psycho]);

  function exportCSV() {
    const headers = [
      "id", "verbatim", "note", "date", "profil", "source",
      "category", "subCategory", "tonality", "confidence",
      // Multi-label : tableau aplati en pipe-séparé
      "all_categories", "all_subcategories", "labels_count",
      "psychoProfile", "valence", "arousal", "dominance",
      "biais", "motivations", "signaux", "classifier", "isUnclassified",
    ];
    const rows = [headers, ...items.map((i) => {
      const labels = Array.isArray(i.categories) && i.categories.length
        ? i.categories
        : [{ cluster_label: i.category, subcluster_label: i.subCategory }];
      return [
        i.id, i.verbatim, i.note ?? "", i.date ?? "", i.profil ?? "", i.source ?? "",
        i.category ?? "", i.subCategory ?? "", i.tonality ?? "", i.confidence ?? 0,
        labels.map((l) => l.cluster_label || "").join("|"),
        labels.map((l) => l.subcluster_label || "").join("|"),
        labels.length,
        i.psychoProfile ?? "",
        i.pad?.valence ?? "", i.pad?.arousal ?? "", i.pad?.dominance ?? "",
        (i.biais || []).join("|"),
        (i.motivations || []).join("|"),
        (i.signaux || []).join("|"),
        i._classifier || "llm",
        i.isUnclassified ? "1" : "0",
      ];
    })];
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCSV(`doria_profiler_${ts}.csv`, rows);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...panelStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}` }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: 14, background: tab === t.id ? PANEL_2 : "transparent",
                border: "none", borderBottom: tab === t.id ? `2px solid ${GOLD}` : "2px solid transparent",
                color: tab === t.id ? GOLD : MUTED, fontSize: 13, fontWeight: 600,
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: 16 }}>
          {tab === "categories" && <TabCategories stats={stats} items={items} onDrill={setDrillItem} />}
          {tab === "evolution" && <TabEvolution stats={stats} items={items} />}
          {tab === "profils" && <TabProfils stats={stats} items={items} />}
          {tab === "items" && <TabItems items={items} onDrill={setDrillItem} />}
        </div>
      </div>

      <ContextChat stats={stats} taxo={taxo} psycho={psycho} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={buttonSecondary}>← Retour à l'analyse</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportCSV} style={buttonSecondary}>↓ Export CSV (UTF-8)</button>
          <button onClick={onReset} style={buttonPrimary}>Nouveau projet</button>
        </div>
      </div>

      {drillItem && <DrillPanel item={drillItem} onClose={() => setDrillItem(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onglet 1 — Catégories : ranking + 4 quadrants (volume × tonalité)
// ─────────────────────────────────────────────────────────────────────────────
function TabCategories({ stats, items, onDrill }) {
  const data = stats.byCategory.map((c, i) => ({
    name: c.name,
    count: c.count,
    insatisfaction: c.pctNeg,
    fill: CAT_COLORS[i % CAT_COLORS.length],
  }));

  // Pour le scatter : x=volume, y=insatisfaction (% neg)
  const scatterData = stats.byCategory.map((c, i) => ({
    name: c.name,
    x: c.count,
    y: c.pctNeg,
    z: 100, // taille fixe
    fill: CAT_COLORS[i % CAT_COLORS.length],
  }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Distribution des catégories</h3>
      <div style={{ height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis type="number" stroke={MUTED} fontSize={11} />
            <YAxis type="category" dataKey="name" stroke={MUTED} fontSize={11} width={110} />
            <Tooltip
              contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }}
              labelStyle={{ color: TEXT }}
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
            />
            <Bar dataKey="count" name="Volume">
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Carte stratégique : volume × insatisfaction</h3>
      <p style={{ margin: 0, color: MUTED, fontSize: 12 }}>
        Les catégories en haut à droite (volume élevé + insatisfaction élevée) sont prioritaires.
      </p>
      <div style={{ height: 320, position: "relative" }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis type="number" dataKey="x" name="Volume" stroke={MUTED} fontSize={11}
              label={{ value: "Volume (nombre de verbatims)", position: "bottom", fill: MUTED, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="% Négatifs" stroke={MUTED} fontSize={11} domain={[0, 100]}
              label={{ value: "% Insatisfaction", angle: -90, position: "left", fill: MUTED, fontSize: 11 }} />
            <ZAxis dataKey="z" range={[300, 300]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }}
              formatter={(v, n, p) => n === "x" ? `${v} verbatims` : `${v}% négatif`}
              labelFormatter={() => ""}
              content={({ payload }) => payload?.[0] && (
                <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, padding: 8, borderRadius: 8, fontSize: 12 }}>
                  <div style={{ color: TEXT, fontWeight: 600 }}>{payload[0].payload.name}</div>
                  <div style={{ color: MUTED }}>Volume : {payload[0].payload.x}</div>
                  <div style={{ color: MUTED }}>% Négatif : {payload[0].payload.y}%</div>
                </div>
              )}
            />
            <Scatter data={scatterData}>
              {scatterData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Top sous-catégories</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        {stats.byCategory.slice(0, 8).map((c, ci) => (
          <div key={ci} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: CAT_COLORS[ci % CAT_COLORS.length], marginBottom: 6 }}>
              {c.name} <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>({c.count})</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11 }}>
              {Object.entries(c.subDist).slice(0, 5).map(([s, n]) => (
                <li key={s} style={{ display: "flex", justifyContent: "space-between", color: MUTED, padding: "2px 0" }}>
                  <span>· {s || "—"}</span><span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onglet 2 — Évolution temporelle
// ─────────────────────────────────────────────────────────────────────────────
function TabEvolution({ stats, items }) {
  if (!stats.timeline.length) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: MUTED, fontSize: 13 }}>
        Aucune donnée temporelle exploitable. Vérifie le mapping de la colonne <code>date</code> à l'import.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Volume mensuel par tonalité</h3>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={stats.timeline}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
            <YAxis stroke={MUTED} fontSize={11} />
            <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
            <Legend />
            <Line type="monotone" dataKey="positif" stroke={POS} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="neutre" stroke={NEUTRAL} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="négatif" stroke={NEG} strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Évolution des top catégories</h3>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={stats.timelineByCat}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis dataKey="month" stroke={MUTED} fontSize={11} />
            <YAxis stroke={MUTED} fontSize={11} />
            <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
            <Legend />
            {stats.topCategories.slice(0, 5).map((c, i) => (
              <Line key={c} type="monotone" dataKey={c} stroke={CAT_COLORS[i]} strokeWidth={2} dot={{ r: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onglet 3 — Profils & Psychologie : PAD radar + biais + carte de tension
// ─────────────────────────────────────────────────────────────────────────────
function TabProfils({ stats, items }) {
  const padByProfile = stats.padByProfile;
  const radarData = ["valence", "arousal", "dominance"].map((k) => {
    const point = { dim: k };
    padByProfile.forEach((p) => { point[p.name] = (p[k] + 1) * 50; }); // remap [-1,1] → [0,100]
    return point;
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Distribution des profils psychographiques</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        {stats.byProfile.map((p, i) => (
          <div key={i} style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT, marginBottom: 4 }}>{p.name || "—"}</div>
            <div style={{ fontSize: 22, color: TEXT, fontWeight: 600 }}>{p.count}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              {Math.round((p.count / items.length) * 100)}% du corpus
            </div>
          </div>
        ))}
      </div>

      {padByProfile.length > 0 && (
        <>
          <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Carte PAD — Pleasure × Arousal × Dominance</h3>
          <p style={{ margin: 0, color: MUTED, fontSize: 12 }}>
            Modèle Mehrabian & Russell (1974). Échelle remappée 0–100 pour la lisibilité (50 = neutre).
          </p>
          <div style={{ height: 320 }}>
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid stroke={BORDER} />
                <PolarAngleAxis dataKey="dim" stroke={MUTED} fontSize={12} />
                <PolarRadiusAxis stroke={MUTED} fontSize={10} domain={[0, 100]} />
                {padByProfile.map((p, i) => (
                  <Radar key={p.name} name={p.name} dataKey={p.name} stroke={CAT_COLORS[i]} fill={CAT_COLORS[i]} fillOpacity={0.2} />
                ))}
                <Legend />
                <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Fréquence des biais cognitifs</h3>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={stats.biaisFreq} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
            <XAxis type="number" stroke={MUTED} fontSize={11} />
            <YAxis type="category" dataKey="name" stroke={MUTED} fontSize={11} width={140} />
            <Tooltip contentStyle={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8 }} />
            <Bar dataKey="count" fill={ACCENT} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>Carte de tension : profils × catégories</h3>
      <p style={{ margin: 0, color: MUTED, fontSize: 12 }}>
        Intensité de la couleur ∝ fréquence négative. Cellules rouge foncé = points de friction prioritaires.
      </p>
      <TensionMap stats={stats} />
    </div>
  );
}

function TensionMap({ stats }) {
  const profiles = stats.byProfile.slice(0, 6).map((p) => p.name).filter(Boolean);
  const categories = stats.topCategories.slice(0, 6);
  if (!profiles.length || !categories.length) {
    return <div style={{ color: MUTED, fontSize: 12 }}>Données insuffisantes pour la carte de tension.</div>;
  }
  // Tension matrix construite : pour chaque (profile, category), % négatif
  const matrix = profiles.map((pr) =>
    categories.map((c) => {
      const cell = stats.tensionMatrix?.[pr]?.[c];
      return cell || { count: 0, neg: 0 };
    })
  );
  const maxNeg = Math.max(1, ...matrix.flat().map((m) => m.neg));

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: 8, color: MUTED, textAlign: "left" }}></th>
            {categories.map((c) => (
              <th key={c} style={{ padding: 8, color: MUTED, fontWeight: 500, fontSize: 10 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((pr, pi) => (
            <tr key={pr}>
              <td style={{ padding: 8, color: ACCENT, fontWeight: 600, fontSize: 11 }}>{pr}</td>
              {matrix[pi].map((cell, ci) => {
                const intensity = cell.neg / maxNeg;
                const bg = `rgba(239,68,68,${intensity * 0.85})`;
                return (
                  <td
                    key={ci}
                    style={{
                      padding: 8, textAlign: "center", background: cell.count ? bg : PANEL_2,
                      border: `1px solid ${BORDER}`, color: TEXT, minWidth: 60,
                    }}
                    title={`${cell.count} verbatims, ${cell.neg} négatifs`}
                  >
                    {cell.count ? cell.neg : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onglet 4 — Items bruts (table filtrable)
// ─────────────────────────────────────────────────────────────────────────────
function TabItems({ items, onDrill }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterTon, setFilterTon] = useState("");
  const [filterUncl, setFilterUncl] = useState(false);

  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category))).filter(Boolean).sort(), [items]);
  const filtered = items.filter((i) => {
    if (search && !i.verbatim.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && i.category !== filterCat) return false;
    if (filterTon && i.tonality !== filterTon) return false;
    if (filterUncl && !i.isUnclassified) return false;
    return true;
  });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher dans les verbatims…"
          style={inputStyle}
        />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="">Toutes catégories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterTon} onChange={(e) => setFilterTon(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="">Toutes tonalités</option>
          <option value="positif">Positif</option>
          <option value="neutre">Neutre</option>
          <option value="négatif">Négatif</option>
          <option value="mixte">Mixte</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={filterUncl} onChange={(e) => setFilterUncl(e.target.checked)} />
          Non classés
        </label>
      </div>
      <div style={{ fontSize: 11, color: MUTED }}>{filtered.length} / {items.length} verbatims</div>
      <div style={{ maxHeight: 500, overflowY: "auto", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, background: PANEL, zIndex: 1 }}>
            <tr>
              {["Verbatim", "Catégorie", "Sous-cat.", "Ton.", "Conf.", "Profil"].map((h) => (
                <th key={h} style={{ padding: 8, textAlign: "left", color: MUTED, fontWeight: 500, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((i) => (
              <tr
                key={i.id}
                onClick={() => onDrill(i)}
                style={{
                  cursor: "pointer", borderBottom: `1px solid ${BORDER}`,
                  background: i.isUnclassified ? "rgba(245,158,11,0.05)" : "transparent",
                }}
              >
                <td style={{ padding: 8, color: TEXT, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.verbatim}</td>
                <td style={{ padding: 8, color: MUTED }}>
                  {i.category}
                  {Array.isArray(i.categories) && i.categories.length > 1 && (
                    <span title={i.categories.map((c) => c.cluster_label).join(" + ")} style={{
                      marginLeft: 6, padding: "1px 6px", background: "rgba(34,211,238,0.15)",
                      color: TEAL, borderRadius: 999, fontSize: 10, fontWeight: 600,
                    }}>
                      +{i.categories.length - 1}
                    </span>
                  )}
                </td>
                <td style={{ padding: 8, color: MUTED }}>{i.subCategory || "—"}</td>
                <td style={{ padding: 8, color: i.tonality === "positif" ? POS : i.tonality === "négatif" ? NEG : NEUTRAL }}>
                  {i.tonality}
                </td>
                <td style={{ padding: 8, color: i.confidence < 0.5 ? NEUTRAL : MUTED }}>{(i.confidence ?? 0).toFixed(2)}</td>
                <td style={{ padding: 8, color: ACCENT }}>{i.psychoProfile || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div style={{ padding: 12, textAlign: "center", color: MUTED, fontSize: 11 }}>
            … {filtered.length - 200} lignes supplémentaires (utilise les filtres pour affiner)
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down panel
// ─────────────────────────────────────────────────────────────────────────────
function DrillPanel({ item, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20,
          maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: GOLD, fontSize: 15 }}>Détail du verbatim #{item.id}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 20 }}>×</button>
        </div>
        <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, color: TEXT, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
          "{item.verbatim}"
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
          <Field label="Catégorie principale" value={item.category} />
          <Field label="Sous-catégorie" value={item.subCategory} />
          <Field label="Tonalité" value={item.tonality} color={item.tonality === "positif" ? POS : item.tonality === "négatif" ? NEG : NEUTRAL} />
          <Field label="Confiance" value={(item.confidence ?? 0).toFixed(2)} />
          <Field label="Profil psy." value={item.psychoProfile} color={ACCENT} />
          <Field label="Note" value={item.note ?? "—"} />
          <Field label="Date" value={item.date ?? "—"} />
          <Field label="Source" value={item.source ?? "—"} />
        </div>
        {Array.isArray(item.categories) && item.categories.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Catégories multiples ({item.categories.length})
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {item.categories.map((c, idx) => (
                <div key={idx} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  fontSize: 12, color: TEXT, padding: "6px 10px", background: PANEL_2,
                  border: `1px solid ${BORDER}`, borderRadius: 8,
                }}>
                  <span>
                    <span style={{ color: idx === 0 ? GOLD : TEAL, fontWeight: 600 }}>
                      {c.cluster_label}
                    </span>
                    {c.subcluster_label && <span style={{ color: MUTED }}> › {c.subcluster_label}</span>}
                  </span>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: MUTED }}>
                    cluster {c.confidence_cluster?.toFixed(2)} · sub {c.confidence_subcluster?.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {item._classifier && (
          <div style={{ marginTop: 8, fontSize: 10, color: MUTED }}>
            Classifié par : <code>{item._classifier}</code>
          </div>
        )}
        {item.pad && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>PAD</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {["valence", "arousal", "dominance"].map((k) => (
                <PadBar key={k} label={k} value={item.pad[k]} />
              ))}
            </div>
          </div>
        )}
        {(item.biais || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Biais cognitifs</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {item.biais.map((b) => (
                <span key={b} style={{ fontSize: 11, background: PANEL_2, border: `1px solid ${BORDER}`, padding: "3px 8px", borderRadius: 12, color: NEUTRAL }}>{b}</span>
              ))}
            </div>
          </div>
        )}
        {(item.signaux || []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Signaux</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {item.signaux.map((s) => (
                <span key={s} style={{ fontSize: 11, background: PANEL_2, border: `1px solid ${BORDER}`, padding: "3px 8px", borderRadius: 12, color: TEAL }}>{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
function Field({ label, value, color }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: color || TEXT, fontWeight: 500, marginTop: 2 }}>{value || "—"}</div>
    </div>
  );
}
function PadBar({ label, value }) {
  // value ∈ [-1, 1] → bar de -50% à +50% autour du centre
  const v = Math.max(-1, Math.min(1, value || 0));
  const pct = Math.abs(v) * 50;
  const positive = v >= 0;
  return (
    <div>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 4, textAlign: "center" }}>{label}</div>
      <div style={{ position: "relative", height: 14, background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 4 }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: BORDER }} />
        <div style={{
          position: "absolute", height: "100%",
          left: positive ? "50%" : `${50 - pct}%`,
          width: `${pct}%`,
          background: positive ? POS : NEG,
          borderRadius: 2,
        }} />
      </div>
      <div style={{ fontSize: 10, color: MUTED, textAlign: "center", marginTop: 2 }}>{v.toFixed(2)}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat contextuel — n'envoie QUE des stats agrégées (pas les verbatims)
// ─────────────────────────────────────────────────────────────────────────────
function ContextChat({ stats, taxo, psycho }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!input.trim() || busy) return;
    const userMsg = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const compactStats = {
        total: stats.total,
        topCategories: stats.byCategory.slice(0, 6).map((c) => ({ name: c.name, count: c.count, pctPos: c.pctPos, pctNeg: c.pctNeg })),
        profiles: stats.byProfile.map((p) => ({ name: p.name, count: p.count })),
        topBiais: stats.biaisFreq.slice(0, 5),
        timeline: stats.timeline.slice(-6),
      };
      const raw = await callClaude(promptContextChat(compactStats, taxo, psycho, userMsg.content, next), { maxTokens: 800 });
      const out = parseJSON(raw);
      const reply = out?.message || "(réponse vide)";
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `⚠ Erreur : ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={panelStyle}>
      <h3 style={{ margin: "0 0 8px 0", color: TEAL, fontSize: 15 }}>Chat contextuel <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>(stats agrégées uniquement)</span></h3>
      {MOCK_AI && (
        <div style={{ marginBottom: 8, fontSize: 11, color: ACCENT }}>
          ℹ Mode démo — configure VITE_ANTHROPIC_API_KEY pour activer le chat.
        </div>
      )}
      <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: 10, display: "grid", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: MUTED, fontSize: 12, padding: 8 }}>
            Pose une question sur les résultats. Ex : « Quelle catégorie a le plus dégradé ce trimestre ? »
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            background: m.role === "user" ? PANEL_2 : "rgba(34,211,238,0.08)",
            border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10,
            fontSize: 13, color: TEXT, lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 10, color: m.role === "user" ? GOLD : TEAL, marginBottom: 4, fontWeight: 600 }}>
              {m.role === "user" ? "Vous" : "Analyste"}
            </div>
            {m.content}
          </div>
        ))}
        {busy && <div style={{ color: MUTED, fontSize: 12 }}>Analyse en cours…</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Pose une question…"
          style={inputStyle}
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()} style={{ ...buttonPrimary, opacity: busy || !input.trim() ? 0.45 : 1 }}>Envoyer</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper multi-label : retourne TOUTES les paires (category, subCategory) d'un item.
// Si l'item a un `categories[]` (mode embeddings multi-label), on dépile.
// Sinon fallback sur `category` / `subCategory` (mode LLM legacy).
// ─────────────────────────────────────────────────────────────────────────────
function expandLabels(item) {
  if (Array.isArray(item.categories) && item.categories.length > 0) {
    return item.categories.map((c) => ({
      category: c.cluster_label || "Autre",
      subCategory: c.subcluster_label || null,
    }));
  }
  return [{
    category: item.category || "Autre",
    subCategory: item.subCategory || null,
  }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation helpers — produit des stats à partir des items enrichis.
// Multi-label aware : chaque verbatim contribue à CHACUNE de ses catégories.
// Conséquence : la somme des `count` par catégorie peut dépasser `total` ;
// on expose donc aussi `pctOfCorpus` (= count / total, peut sommer >100%).
// ─────────────────────────────────────────────────────────────────────────────
function buildStats(items, taxo, psycho) {
  const total = items.length;

  // Par catégorie — chaque verbatim ajoute 1 à chacune de ses catégories
  const catMap = {};
  items.forEach((i) => {
    const labels = expandLabels(i);
    for (const { category, subCategory } of labels) {
      const c = category;
      if (!catMap[c]) catMap[c] = { name: c, count: 0, pos: 0, neg: 0, neutre: 0, mixte: 0, subDist: {} };
      catMap[c].count++;
      catMap[c][i.tonality || "neutre"] = (catMap[c][i.tonality || "neutre"] || 0) + 1;
      const sub = subCategory || "—";
      catMap[c].subDist[sub] = (catMap[c].subDist[sub] || 0) + 1;
    }
  });
  const byCategory = Object.values(catMap)
    .map((c) => ({
      ...c,
      pctPos: c.count ? Math.round((c.pos / c.count) * 100) : 0,
      pctNeg: c.count ? Math.round((c.neg / c.count) * 100) : 0,
      pctOfCorpus: total ? Math.round((c.count / total) * 100) : 0,
      subDist: Object.fromEntries(Object.entries(c.subDist).sort((a, b) => b[1] - a[1])),
    }))
    .sort((a, b) => b.count - a.count);
  const topCategories = byCategory.slice(0, 5).map((c) => c.name);

  // Par profil psy
  const profMap = {};
  items.forEach((i) => {
    const p = i.psychoProfile || "Indéterminé";
    if (!profMap[p]) profMap[p] = { name: p, count: 0, valSum: 0, arSum: 0, doSum: 0, padN: 0 };
    profMap[p].count++;
    if (i.pad) {
      profMap[p].valSum += i.pad.valence ?? 0;
      profMap[p].arSum += i.pad.arousal ?? 0;
      profMap[p].doSum += i.pad.dominance ?? 0;
      profMap[p].padN++;
    }
  });
  const byProfile = Object.values(profMap).sort((a, b) => b.count - a.count);
  const padByProfile = byProfile
    .filter((p) => p.padN > 0 && p.name !== "Indéterminé")
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      valence: p.valSum / p.padN,
      arousal: p.arSum / p.padN,
      dominance: p.doSum / p.padN,
    }));

  // Biais cognitifs
  const biaisMap = {};
  items.forEach((i) => (i.biais || []).forEach((b) => { biaisMap[b] = (biaisMap[b] || 0) + 1; }));
  const biaisFreq = Object.entries(biaisMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Timeline mensuelle (multi-label : chaque verbatim incrémente toutes ses catégories)
  const tlMap = {}; // month → { positif, neutre, négatif, mixte, total }
  const tlCatMap = {}; // month → { cat: count }
  items.forEach((i) => {
    const d = parseDate(i.date);
    const m = monthKey(d);
    if (!m) return;
    if (!tlMap[m]) tlMap[m] = { month: m, positif: 0, neutre: 0, "négatif": 0, mixte: 0 };
    tlMap[m][i.tonality || "neutre"] = (tlMap[m][i.tonality || "neutre"] || 0) + 1;

    if (!tlCatMap[m]) tlCatMap[m] = { month: m };
    for (const { category } of expandLabels(i)) {
      tlCatMap[m][category] = (tlCatMap[m][category] || 0) + 1;
    }
  });
  const timeline = Object.values(tlMap).sort((a, b) => a.month.localeCompare(b.month));
  const timelineByCat = Object.values(tlCatMap).sort((a, b) => a.month.localeCompare(b.month));

  // Tension matrix : profil × catégorie → {count, neg}
  // Multi-label : un verbatim incrémente toutes ses paires (profil, catégorie)
  const tensionMatrix = {};
  items.forEach((i) => {
    const p = i.psychoProfile || "Indéterminé";
    for (const { category: c } of expandLabels(i)) {
      if (!tensionMatrix[p]) tensionMatrix[p] = {};
      if (!tensionMatrix[p][c]) tensionMatrix[p][c] = { count: 0, neg: 0 };
      tensionMatrix[p][c].count++;
      if (i.tonality === "négatif") tensionMatrix[p][c].neg++;
    }
  });

  return {
    total, byCategory, topCategories, byProfile, padByProfile, biaisFreq,
    timeline, timelineByCat, tensionMatrix,
  };
}
