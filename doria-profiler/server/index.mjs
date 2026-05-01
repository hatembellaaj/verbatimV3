// Proxy Anthropic — relaie POST /api/messages vers api.anthropic.com avec la clé serveur.
// Le frontend appelle /api/messages (même origine), le proxy ajoute x-api-key.
// Avantage : la clé n'apparaît jamais dans le bundle JS du navigateur.

import express from "express";

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQ_TIMEOUT_MS = 120_000;

if (!API_KEY) {
  console.error("⚠ ANTHROPIC_API_KEY manquante — /api/messages renverra 500 sur tous les appels");
}

const app = express();
// Les prompts peuvent être gros (~50 KB pour un batch), on monte la limite à 5 MB.
app.use(express.json({ limit: "5mb" }));

// Health-check trivial — utilisé par docker compose et par l'UI au démarrage.
app.get("/api/health", (_, res) => {
  res.json({ ok: true, hasKey: !!API_KEY });
});

app.post("/api/messages", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: { message: "Clé API manquante côté serveur (ANTHROPIC_API_KEY)" } });
  }

  // Timeout dur côté proxy au cas où Anthropic ne répond pas.
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

    // Forward le retry-after pour que le client puisse respecter la consigne.
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Proxy Anthropic up on :${PORT} (key: ${API_KEY ? "OK" : "MANQUANTE"})`);
});
