// Phase 3 — Analyse complète par batches de 10
// spec § III.2 — BATCH_SIZE=10, parallélisme contrôlé, seuil de confiance 0.5
import React, { useState, useRef, useEffect } from "react";
import { callClaude, MOCK_AI, getUsage, resetUsage } from "../api/claude.js";
import { promptAnalyseBatch } from "../lib/prompts.js";
import { parseJSON, pLimit } from "../lib/utils.js";
import {
  logInfo, logOk, logWarn, logErr, logLlm, subscribeLogs, getLogs, clearLogs,
  formatTime, LEVEL_COLORS,
} from "../lib/logger.js";
import {
  PANEL, PANEL_2, BORDER, MUTED, TEXT, GOLD, TEAL, ACCENT, POS, NEG, NEUTRAL,
  panelStyle, buttonPrimary, buttonSecondary,
} from "../lib/theme.js";

const BATCH_SIZE = 10;
const CONCURRENCY = 2; // baissé de 4 → 2 pour rester sous le rate-limit standard Anthropic (50 RPM tier 1)
const CONFIDENCE_THRESHOLD = 0.5;

export default function PhaseAnalyse({ items, taxo, psycho, contexte, initialResults, onResultsChange, onValidate, onBack }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  // Hydrate depuis le parent → survit aux navigations entre phases ET aux reloads (via localStorage App.jsx)
  const [results, setResults] = useState(initialResults || null);
  const [error, setError] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  // Phase de retry final (en série, après la 1ère passe parallèle) — null quand inactif.
  const [retrying, setRetrying] = useState(null); // { done, total }
  const cancelRef = useRef(false);
  const completionRef = useRef(null);

  // Synchro live vers le parent (App.jsx persiste en localStorage)
  function pushResults(r) {
    setResults(r);
    if (onResultsChange) onResultsChange(r || []);
  }

  const totalBatches = Math.ceil(items.length / BATCH_SIZE);

  // Tick pour ETA
  useEffect(() => {
    if (!running || !startTime) return;
    const id = setInterval(() => setElapsed(Date.now() - startTime), 500);
    return () => clearInterval(id);
  }, [running, startTime]);

  // Scroll vers le banner de fin quand l'analyse termine avec succès
  useEffect(() => {
    if (results && !running && completionRef.current) {
      completionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [results, running]);

  const eta = (() => {
    if (!running || done === 0) return null;
    const perBatch = elapsed / done;
    const remaining = (totalBatches - done) * perBatch;
    return Math.round(remaining / 1000);
  })();

  // Helper : exécute un batch (1 appel API + parse) et écrit les items dans `enriched`.
  // Retourne { ok: bool, error?: string } pour que l'appelant puisse décider du retry.
  async function processBatch({ batch, bi, totalBatches, enriched, label, callOpts }) {
    const verbatims = batch.map((b) => b.verbatim);
    const prompt = promptAnalyseBatch(taxo, psycho, verbatims, contexte);
    let parsed = null;
    let batchError = null;
    try {
      const raw = await callClaude(prompt, { maxTokens: 6000, label, ...callOpts });
      parsed = parseJSON(raw);
      if (!parsed?.items) {
        batchError = "Réponse JSON invalide ou sans clé 'items'";
        logWarn(`${label} : ${batchError}. Premier 200 chars: ${(raw || "").slice(0, 200)}`);
      } else if (parsed.items.length < batch.length) {
        logWarn(`${label} : ${parsed.items.length}/${batch.length} items renvoyés — possible troncature. Les manquants seront en "Autre".`);
      }
    } catch (e) {
      batchError = e.message;
    }

    const items_out = (batchError ? null : parsed?.items) || [];
    batch.forEach((src, idx) => {
      const r = items_out.find((x) => x.idx === idx) || items_out[idx] || {};
      const isUnclassified = !!batchError || !r.category || r.category === "Autre" || (r.confidence ?? 0) < CONFIDENCE_THRESHOLD;
      enriched[bi * BATCH_SIZE + idx] = {
        ...src,
        category: r.category || "Autre",
        subCategory: r.subCategory || null,
        tonality: r.tonality || "neutre",
        confidence: r.confidence ?? 0,
        psychoProfile: r.psychoProfile || null,
        pad: r.pad || { valence: 0, arousal: 0, dominance: 0 },
        biais: Array.isArray(r.biais) ? r.biais : [],
        motivations: Array.isArray(r.motivations) ? r.motivations : [],
        signaux: Array.isArray(r.signaux) ? r.signaux : [],
        isUnclassified,
        _error: batchError || r.error || null,
      };
    });
    return { ok: !batchError, error: batchError };
  }

  async function runAnalysis() {
    setRunning(true);
    setError(null);
    setDone(0);
    setTotal(totalBatches);
    setRetrying(null);
    pushResults(null);
    setStartTime(Date.now());
    cancelRef.current = false;
    resetUsage();

    logInfo(`════════ Démarrage analyse ════════`);
    logInfo(`${items.length} verbatims · ${totalBatches} batches × ${BATCH_SIZE} · concurrency ${CONCURRENCY}`);
    logInfo(`Mode : ${MOCK_AI ? "DÉMO (mock)" : "API réelle"}`);

    // ─── Garde-fou : détecte les verbatims vides AVANT de cramer des tokens ───
    const empty = items.filter((it) => !it.verbatim || String(it.verbatim).trim().length < 3).length;
    const emptyRatio = empty / items.length;
    if (emptyRatio > 0.1) {
      const msg = `⚠ ${empty}/${items.length} verbatims sont vides ou < 3 caractères (${Math.round(emptyRatio * 100)}%). Le mapping de colonne en Phase 1 a probablement ciblé la mauvaise colonne. Retour à l'import recommandé.`;
      logErr(msg);
      setError(msg);
      setRunning(false);
      return;
    }
    if (empty > 0) {
      logWarn(`${empty} verbatim(s) vide(s) détecté(s) — ils seront classés en "Autre" sans appel API`);
    }
    const sample = items.find((it) => it.verbatim && String(it.verbatim).trim().length > 0)?.verbatim || "";
    logInfo(`Échantillon verbatim #1 : "${String(sample).slice(0, 120)}${sample.length > 120 ? "…" : ""}"`);

    try {
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        batches.push(items.slice(i, i + BATCH_SIZE));
      }

      const limit = pLimit(CONCURRENCY);
      const enriched = new Array(items.length);
      let okBatches = 0, koBatches = 0;
      const failedBatches = []; // { bi, batch } — pour le retry final en série

      // ─── PASSE 1 : parallèle ───
      await Promise.all(batches.map((batch, bi) => limit(async () => {
        if (cancelRef.current) return;
        const { ok, error: bErr } = await processBatch({
          batch, bi, totalBatches, enriched,
          label: `batch ${bi + 1}/${totalBatches}`,
        });
        if (ok) okBatches++;
        else {
          koBatches++;
          failedBatches.push({ bi, batch, error: bErr });
        }
        setDone((d) => d + 1);
        // Sync live vers le parent → l'utilisateur peut voir l'avancée s'il navigue
        pushResults(enriched.filter(Boolean));
      })));

      if (cancelRef.current) {
        logWarn("Analyse annulée par l'utilisateur");
        setError("Analyse annulée par l'utilisateur");
        return;
      }

      logOk(`════════ Passe 1 terminée ════════`);
      logOk(`${okBatches} OK · ${koBatches} en erreur sur ${totalBatches} batches`);

      // ─── PASSE 2 : retry final en série pour les batches morts ───
      if (failedBatches.length > 0 && !cancelRef.current) {
        logWarn(`════════ Retry final : ${failedBatches.length} batches à rejouer en série (concurrency=1, backoff jusqu'à 90s, 10 retries) ════════`);
        setRetrying({ done: 0, total: failedBatches.length });
        let recovered = 0;
        for (let i = 0; i < failedBatches.length; i++) {
          if (cancelRef.current) break;
          const { bi, batch } = failedBatches[i];
          const { ok } = await processBatch({
            batch, bi, totalBatches, enriched,
            label: `RETRY ${i + 1}/${failedBatches.length} (batch original ${bi + 1})`,
            callOpts: { maxRetries: 10, maxBackoffMs: 90000 },
          });
          if (ok) {
            recovered++;
            logOk(`RETRY batch ${bi + 1} : récupéré (${recovered}/${failedBatches.length})`);
          } else {
            logErr(`RETRY batch ${bi + 1} : échec définitif même en série — items resteront en "Autre"`);
          }
          setRetrying({ done: i + 1, total: failedBatches.length });
          pushResults(enriched.filter(Boolean));
        }
        okBatches += recovered;
        koBatches -= recovered;
        logOk(`Retry final : ${recovered}/${failedBatches.length} batches récupérés`);
        setRetrying(null);
      }

      if (cancelRef.current) {
        logWarn("Analyse annulée par l'utilisateur (pendant retry)");
        setError("Analyse annulée par l'utilisateur");
        return;
      }

      const finalItems = enriched.filter(Boolean);
      logOk(`════════ Analyse terminée ════════`);
      logOk(`${okBatches} batches OK · ${koBatches} en erreur · ${finalItems.length} items enrichis`);
      const u = getUsage();
      if (!MOCK_AI) {
        const cost = (u.tokensIn / 1e6) * 3 + (u.tokensOut / 1e6) * 15;
        logOk(`Tokens cumulés : ${u.tokensIn.toLocaleString()} in / ${u.tokensOut.toLocaleString()} out — coût estimé : ${cost.toFixed(3)} $`);
      }
      pushResults(finalItems);
    } catch (e) {
      logErr(`Exception non capturée dans runAnalysis : ${e.message}`, e);
      setError(e.message);
    } finally {
      setRunning(false);
      setRetrying(null);
    }
  }

  function cancel() {
    cancelRef.current = true;
    setRunning(false);
    logWarn("Annulation demandée par l'utilisateur");
  }

  const usage = getUsage();
  const progress = total ? (done / total) * 100 : 0;
  const summary = results ? buildSummary(results) : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <h2 style={{ margin: "0 0 8px 0", color: GOLD, fontSize: 18 }}>Phase 3 — Analyse complète</h2>
        <p style={{ margin: "0 0 12px 0", color: MUTED, fontSize: 13 }}>
          {items.length} verbatims, {totalBatches} batches de {BATCH_SIZE}, parallélisme {CONCURRENCY}.
          Chaque verbatim sera classé (cat/sous-cat/tonalité/confiance) ET profilé (PAD, biais, motivations, signaux).
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!running && !results && (
            <button onClick={runAnalysis} style={buttonPrimary}>Démarrer l'analyse</button>
          )}
          {running && (
            <button onClick={cancel} style={{ ...buttonSecondary, color: NEG, borderColor: NEG }}>Annuler</button>
          )}
          {results && !running && (
            <button onClick={runAnalysis} style={buttonSecondary}>Relancer l'analyse</button>
          )}
        </div>

        {(running || results) && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: MUTED }}>
              <span>Progression : {done} / {total} batches</span>
              <span>
                {running && eta != null && `ETA ~ ${eta}s · `}
                {Math.round(progress)}%
              </span>
            </div>
            <div style={{ height: 8, background: PANEL_2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${TEAL}, ${GOLD})`, transition: "width 0.3s" }} />
            </div>
            {!MOCK_AI && (
              <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>
                Tokens : {usage.tokensIn.toLocaleString()} in / {usage.tokensOut.toLocaleString()} out · {usage.calls} appels
              </div>
            )}
          </div>
        )}

        {retrying && (
          <div style={{ marginTop: 12, padding: 12, background: "rgba(245,158,11,0.08)", border: `1px solid ${NEUTRAL}`, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12, color: NEUTRAL, fontWeight: 600 }}>
              <span>↻ Retry final en série · batches en erreur de la passe 1</span>
              <span>{retrying.done} / {retrying.total}</span>
            </div>
            <div style={{ height: 6, background: PANEL_2, borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                width: `${retrying.total ? (retrying.done / retrying.total) * 100 : 0}%`,
                height: "100%",
                background: NEUTRAL,
                transition: "width 0.3s",
              }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: MUTED }}>
              concurrency=1, max 10 retries, backoff jusqu'à 90s — récupère les batches morts par rate-limit
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: 12, background: "#3B0F14", border: `1px solid ${NEG}`, borderRadius: 8, color: "#FCA5A5", fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* ─────── BANNIÈRE DE FIN — bien visible ─────── */}
      {results && !running && (
        <div
          ref={completionRef}
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(212,175,55,0.15))",
            border: `2px solid ${POS}`,
            borderRadius: 12,
            padding: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: POS, marginBottom: 4 }}>
              ✓ Analyse terminée
            </div>
            <div style={{ fontSize: 13, color: TEXT }}>
              {summary?.classified} classés · {summary?.unclassified} non classés · {summary?.errors} erreurs
              {!MOCK_AI && ` · ~${((usage.tokensIn / 1e6) * 3 + (usage.tokensOut / 1e6) * 15).toFixed(2)} $`}
            </div>
          </div>
          <button
            onClick={() => onValidate({ items: results })}
            style={{ ...buttonPrimary, fontSize: 14, padding: "12px 20px" }}
          >
            Voir les résultats →
          </button>
        </div>
      )}

      {summary && (
        <div style={panelStyle}>
          <h3 style={{ margin: "0 0 12px 0", color: TEAL, fontSize: 15 }}>Résumé pré-vue</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
            <Stat label="Classés" value={summary.classified} hint={`${Math.round(summary.classified / results.length * 100)}%`} color={POS} />
            <Stat label="Non classés" value={summary.unclassified} hint={`conf < ${CONFIDENCE_THRESHOLD}`} color={NEUTRAL} />
            <Stat label="Erreurs" value={summary.errors} color={summary.errors > 0 ? NEG : MUTED} />
            <Stat label="Confiance moy." value={summary.avgConfidence.toFixed(2)} />
            <Stat label="% Positifs" value={`${summary.pctPos}%`} color={POS} />
            <Stat label="% Négatifs" value={`${summary.pctNeg}%`} color={NEG} />
          </div>
        </div>
      )}

      {/* ─────── PANEL CONSOLE ─────── */}
      <ConsolePanel />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <button onClick={onBack} style={buttonSecondary} disabled={running}>← Retour à la calibration</button>
        <button
          disabled={!results || running}
          onClick={() => onValidate({ items: results })}
          style={{ ...buttonPrimary, opacity: results && !running ? 1 : 0.45, cursor: results && !running ? "pointer" : "not-allowed" }}
        >
          Voir les résultats →
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, color }) {
  return (
    <div style={{ background: PANEL_2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, color: color || TEXT, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function buildSummary(items) {
  const total = items.length;
  const classified = items.filter((i) => !i.isUnclassified).length;
  const unclassified = items.filter((i) => i.isUnclassified).length;
  const errors = items.filter((i) => i._error).length;
  const confs = items.map((i) => i.confidence || 0);
  const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const pos = items.filter((i) => i.tonality === "positif").length;
  const neg = items.filter((i) => i.tonality === "négatif").length;
  return {
    classified, unclassified, errors, avgConfidence,
    pctPos: total ? Math.round(pos / total * 100) : 0,
    pctNeg: total ? Math.round(neg / total * 100) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Console intégré — affiche les logs en temps réel
// ─────────────────────────────────────────────────────────────────────────────
function ConsolePanel() {
  const [logs, setLogs] = useState(() => getLogs());
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeLogs((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        // garde au max 500
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return unsub;
  }, []);

  // Auto-scroll vers le bas si l'utilisateur ne scrolle pas manuellement
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isAtBottom) el.scrollTop = el.scrollHeight;
  }, [logs, open]);

  const filtered = filter
    ? logs.filter((l) => l.msg?.toLowerCase().includes(filter.toLowerCase()) || l.level.includes(filter.toLowerCase()))
    : logs;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 12 : 0 }}>
        <h3 style={{ margin: 0, color: TEAL, fontSize: 15 }}>
          Console <span style={{ color: MUTED, fontWeight: 400, fontSize: 11 }}>({logs.length} entrées · aussi visible dans la devtools du navigateur)</span>
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {open && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrer…"
              style={{
                background: PANEL_2, border: `1px solid ${BORDER}`, color: TEXT,
                borderRadius: 6, padding: "4px 8px", fontSize: 11, width: 140,
              }}
            />
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
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ color: MUTED }}>(pas encore de logs — démarre l'analyse pour voir les appels API en temps réel)</div>
          ) : (
            filtered.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 8, color: TEXT }}>
                <span style={{ color: MUTED, flexShrink: 0 }}>{formatTime(l.ts)}</span>
                <span style={{ color: LEVEL_COLORS[l.level] || MUTED, fontWeight: 600, flexShrink: 0, minWidth: 40 }}>{l.level}</span>
                <span style={{ wordBreak: "break-word" }}>{l.msg}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
