// Panel console réutilisable — affiche les logs en temps réel,
// avec filtre, auto-scroll, vidage. Utilisé par PhaseAnalyse et PhaseClassify.
import React, { useState, useEffect, useRef } from "react";
import {
  subscribeLogs, getLogs, clearLogs, formatTime, LEVEL_COLORS,
} from "../lib/logger.js";
import {
  PANEL_2, BORDER, MUTED, TEXT, TEAL,
  panelStyle, buttonSecondary,
} from "../lib/theme.js";

export default function ConsolePanel({ defaultOpen = true, maxHeight = 320, title = "Console" }) {
  const [logs, setLogs] = useState(() => getLogs());
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeLogs((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return unsub;
  }, []);

  // Auto-scroll si l'utilisateur est déjà en bas
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isAtBottom) el.scrollTop = el.scrollHeight;
  }, [logs, open]);

  const filtered = logs.filter((l) => {
    if (levelFilter && l.level !== levelFilter) return false;
    if (filter && !(l.msg?.toLowerCase().includes(filter.toLowerCase()))) return false;
    return true;
  });

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 12 : 0, gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>
          {title} <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>
            ({logs.length} entrées{filter || levelFilter ? `, ${filtered.length} filtrées` : ""} · DevTools navigateur aussi)
          </span>
        </h3>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {open && (
            <>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                style={{
                  background: PANEL_2, border: `1px solid ${BORDER}`, color: TEXT,
                  borderRadius: 6, padding: "4px 8px", fontSize: 11,
                }}
              >
                <option value="">Tous niveaux</option>
                <option value="info">info</option>
                <option value="ok">ok</option>
                <option value="warn">warn</option>
                <option value="err">err</option>
                <option value="api">api</option>
                <option value="llm">llm</option>
                <option value="dbg">dbg</option>
              </select>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer…"
                style={{
                  background: PANEL_2, border: `1px solid ${BORDER}`, color: TEXT,
                  borderRadius: 6, padding: "4px 8px", fontSize: 11, width: 140,
                }}
              />
            </>
          )}
          <button onClick={() => { clearLogs(); setLogs([]); }} style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11 }}>Vider</button>
          <button onClick={() => setOpen(!open)} style={{ ...buttonSecondary, padding: "4px 10px", fontSize: 11 }}>
            {open ? "Replier" : "Déplier"}
          </button>
        </div>
      </div>
      {open && (
        <div
          ref={scrollRef}
          style={{
            background: "#06101C",
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            maxHeight,
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ color: MUTED }}>(aucun log à afficher)</div>
          ) : (
            filtered.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 8, color: TEXT }}>
                <span style={{ color: MUTED, flexShrink: 0 }}>{formatTime(l.ts)}</span>
                <span style={{ color: LEVEL_COLORS[l.level] || MUTED, fontWeight: 600, flexShrink: 0, minWidth: 40 }}>{l.level}</span>
                <span style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
