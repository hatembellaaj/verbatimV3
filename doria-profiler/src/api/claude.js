// Wrapper Anthropic Messages API — spec § II.1
// Le frontend appelle un proxy backend en same-origin (/api/messages) qui injecte la clé.
// La clé API n'est JAMAIS exposée dans le bundle JS — elle vit côté serveur (service `api`).
// Mode mock activable via VITE_USE_MOCK=true (utile pour dev offline).

import { logApi, logErr, logWarn, logOk, logLlm } from "../lib/logger.js";

export const MOCK_AI = String(import.meta.env.VITE_USE_MOCK || "").toLowerCase() === "true";

// Modèle par défaut — surchargeable via VITE_ANTHROPIC_MODEL dans .env.local
// Modèles valides à fin avril 2026 : claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5-20251001
const DEFAULT_MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || "claude-sonnet-4-6";
// Endpoint relatif → routé par nginx vers le proxy Node, qui ajoute x-api-key + anthropic-version.
const ENDPOINT = "/api/messages";

// Compteur de tokens approximatif pour debug/coût
let _tokensIn = 0, _tokensOut = 0, _calls = 0;
export function getUsage() {
  return { tokensIn: _tokensIn, tokensOut: _tokensOut, calls: _calls };
}
export function resetUsage() { _tokensIn = 0; _tokensOut = 0; _calls = 0; }

// Appel unique avec retry exponentiel sur 429/503/réseau.
// Respecte le header `retry-after` d'Anthropic quand il est présent (en secondes ou date HTTP).
export async function callClaude(prompt, opts = {}) {
  const {
    model = DEFAULT_MODEL,
    maxTokens = 4096,
    temperature = 0.2,
    system = "Tu es un analyste sémantique expert. Tu réponds STRICTEMENT en JSON valide, sans prose ni commentaires hors JSON.",
    maxRetries = 7,            // ↑ de 4 à 7 — couvre des fenêtres de rate-limit plus longues
    maxBackoffMs = 60000,      // ↑ plafond 30s → 60s
    onRetry = null,
    label = "claude",
  } = opts;

  if (MOCK_AI) {
    logLlm(`[${label}] MOCK (VITE_USE_MOCK=true) — réponse simulée`);
    return mockResponse(prompt);
  }

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: prompt }],
  };

  const start = Date.now();
  logApi(`[${label}] → ${model} (prompt ${prompt.length} chars, max_tokens ${maxTokens})`);

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Le proxy Node ajoute x-api-key + anthropic-version. On envoie juste le payload.
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 529 || res.status === 503) {
        // Anthropic peut renvoyer un header `retry-after` — on le respecte si présent.
        const retryAfterHdr = res.headers.get("retry-after");
        const serverHint = parseRetryAfter(retryAfterHdr);
        // Backoff exponentiel + jitter ±20% pour désynchroniser les workers concurrents.
        const exp = Math.min(2000 * Math.pow(2, attempt), maxBackoffMs);
        const jittered = Math.round(exp * (0.8 + Math.random() * 0.4));
        const wait = Math.min(Math.max(serverHint || 0, jittered), maxBackoffMs);
        const src = serverHint ? "retry-after serveur" : "backoff exp + jitter";
        logWarn(`[${label}] HTTP ${res.status} — retry dans ${wait}ms (${src}, essai ${attempt + 1}/${maxRetries + 1})`);
        if (onRetry) onRetry({ attempt, status: res.status, wait, retryAfter: serverHint });
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        const errMsg = `Claude API ${res.status}: ${errText.slice(0, 300)}`;
        logErr(`[${label}] ${errMsg}`);
        throw new Error(errMsg);
      }

      const data = await res.json();
      _calls++;
      const inT = data.usage?.input_tokens || 0;
      const outT = data.usage?.output_tokens || 0;
      _tokensIn += inT;
      _tokensOut += outT;
      const text = data.content?.[0]?.text || "";
      const ms = Date.now() - start;
      logOk(`[${label}] ← ${inT}↗ ${outT}↘ tokens en ${ms}ms (réponse ${text.length} chars)`);
      return text;
    } catch (err) {
      lastErr = err;
      const exp = Math.min(1500 * Math.pow(2, attempt), maxBackoffMs);
      const wait = Math.round(exp * (0.8 + Math.random() * 0.4));
      logWarn(`[${label}] erreur réseau "${err.message}" — retry dans ${wait}ms (essai ${attempt + 1}/${maxRetries + 1})`);
      if (onRetry) onRetry({ attempt, error: err.message, wait });
      await sleep(wait);
    }
  }
  const finalErr = lastErr || new Error("callClaude: échec après retries");
  logErr(`[${label}] échec définitif après ${maxRetries + 1} tentatives : ${finalErr.message}`);
  throw finalErr;
}

// Helper concurrent — utilise pLimit en interne via la fonction founie
export async function callClaudeBatch(prompts, opts = {}) {
  const { concurrency = 2, onProgress = null, ...rest } = opts; // ↓ 4 → 2 pour rester sous le rate-limit
  const { pLimit } = await import("../lib/utils.js");
  const limit = pLimit(concurrency);
  let done = 0;
  const tasks = prompts.map((p, i) =>
    limit(async () => {
      const out = await callClaude(p, rest);
      done++;
      if (onProgress) onProgress({ done, total: prompts.length, index: i });
      return out;
    })
  );
  return Promise.all(tasks);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse le header `retry-after` (RFC 7231) → renvoie ms, ou null si absent/invalide.
// Format 1 : entier en secondes (ex: "30")
// Format 2 : date HTTP (ex: "Wed, 21 Oct 2026 07:28:00 GMT")
function parseRetryAfter(hdr) {
  if (!hdr) return null;
  const trimmed = String(hdr).trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum * 1000);
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock — retourne un JSON crédible selon le type de prompt
// ─────────────────────────────────────────────────────────────────────────────
function mockResponse(prompt) {
  const p = prompt.toLowerCase();
  // Calibration P1 / P2 / P3 — découverte / validation taxonomique
  if (p.includes("découverte") || p.includes("decouverte") || p.includes("propose une taxonomie")) {
    return JSON.stringify({
      categories: [
        { name: "Service", subCategories: ["Accueil", "Réactivité", "Compétence"] },
        { name: "Produit", subCategories: ["Qualité", "Prix", "Fraîcheur"] },
        { name: "Cadre", subCategories: ["Propreté", "Ambiance", "Confort"] },
        { name: "Logistique", subCategories: ["Attente", "Disponibilité"] },
      ],
      psychoProfiles: [
        { name: "Pragmatique exigeant", description: "Cherche efficacité et rapport qualité-prix", traits: ["pragmatique", "rationnel"] },
        { name: "Hédoniste affectif", description: "Recherche d'expérience plaisante", traits: ["émotionnel", "sensoriel"] },
        { name: "Loyal communautaire", description: "Attachement à la marque et aux relations", traits: ["fidèle", "social"] },
      ],
    });
  }
  // Résidus P4
  if (p.includes("résidus") || p.includes("residus") || p.includes("hors-échantillon")) {
    return JSON.stringify({ adjustments: [], coverage: 0.95 });
  }
  // Analyse batch
  if (p.includes("analyse les verbatims") || p.includes("analyse ce batch") || p.includes("renvoie un tableau")) {
    // Devine combien de verbatims dans le prompt (très approximatif)
    const count = (prompt.match(/^\d+\.\s/gm) || []).length || 5;
    const items = Array.from({ length: count }, (_, i) => ({
      idx: i,
      category: ["Service", "Produit", "Cadre", "Logistique"][i % 4],
      subCategory: ["Accueil", "Qualité", "Propreté", "Attente"][i % 4],
      tonality: ["positif", "négatif", "neutre"][i % 3],
      confidence: 0.55 + (i % 4) * 0.1,
      psychoProfile: ["Pragmatique exigeant", "Hédoniste affectif", "Loyal communautaire"][i % 3],
      pad: { valence: (i % 5 - 2) / 2, arousal: (i % 3 - 1) / 2, dominance: (i % 4 - 2) / 2 },
      biais: i % 2 ? ["confirmation"] : [],
      motivations: ["recherche d'efficacité"],
      signaux: ["rapidité", "service"],
    }));
    return JSON.stringify({ items });
  }
  // Chat contextuel
  return JSON.stringify({ message: "Mode démo (sans clé API). Configure VITE_ANTHROPIC_API_KEY pour activer Claude." });
}
