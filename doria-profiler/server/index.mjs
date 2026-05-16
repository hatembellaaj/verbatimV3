// Proxy Anthropic + API métier (catégories, projets) — DORIA Profiler.
// Routes :
//   GET  /api/health           → état (clé Anthropic + DB)
//   POST /api/messages         → relais Anthropic (clé injectée serveur)
//   GET/POST/DELETE /api/categories[/:id]
//   GET/POST/DELETE /api/projects[/:id]

import express from "express";
import { runMigrations } from "./db/migrate.mjs";
import { pool } from "./db/pool.mjs";
import { router as categoriesRouter } from "./routes/categories.mjs";
import { router as projectsRouter } from "./routes/projects.mjs";

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQ_TIMEOUT_MS = 120_000;

if (!API_KEY) {
  console.error("⚠ ANTHROPIC_API_KEY manquante — /api/messages renverra 500 sur tous les appels");
}

const app = express();
// Limite à 20 MB : payload d'un projet complet (verbatims + classifications) peut dépasser 5 MB.
app.use(express.json({ limit: "20mb" }));

// ─── Health (incl. état DB) ────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  try {
    await pool.query("SELECT 1");
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.json({ ok: true, hasKey: !!API_KEY, db: dbOk });
});

// ─── Routes métier ──────────────────────────────────────────────────────
app.use("/api/categories", categoriesRouter);
app.use("/api/projects", projectsRouter);

// ─── Proxy Anthropic ────────────────────────────────────────────────────
app.post("/api/messages", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: { message: "Clé API manquante côté serveur (ANTHROPIC_API_KEY)" } });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(req.body || {}),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.set("retry-after", retryAfter);

    const ct = upstream.headers.get("content-type") || "application/json";
    res.set("Content-Type", ct);
    res.status(upstream.status);

    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    clearTimeout(t);
    const msg = err.name === "AbortError" ? "upstream timeout" : err.message;
    console.error("[proxy] error:", msg);
    res.status(502).json({ error: { message: `Proxy error: ${msg}` } });
  }
});

// ─── Boot ───────────────────────────────────────────────────────────────
(async () => {
  try {
    await runMigrations();
    console.log("[db] Migrations OK");
  } catch (e) {
    console.error("[db] ÉCHEC migrations :", e.message);
    // On démarre quand même — l'endpoint /api/health signalera db=false
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✓ DORIA api up on :${PORT} (key: ${API_KEY ? "OK" : "MANQUANTE"})`);
  });
})();
