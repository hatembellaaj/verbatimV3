// Logger central — émet vers la console + un buffer (mémoire + localStorage)
// abonnable pour affichage dans l'UI (panel console intégré dans PhaseAnalyse).

const MAX_BUFFER = 500;
const STORAGE_KEY = "doria-profiler:logs";
const STORAGE_PERSIST = 200;            // on persiste les 200 derniers
const buffer = [];
const subscribers = new Set();
let counter = 0;

// Hydrate depuis localStorage au chargement du module
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      buffer.push(...parsed);
      counter = Math.max(...parsed.map((e) => e.id || 0), 0);
    }
  }
} catch { /* swallow */ }

// Sauvegarde throttle (au plus 1 fois / 500ms)
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-STORAGE_PERSIST)));
    } catch { /* quota — on laisse tomber silencieusement */ }
  }, 500);
}

export const LEVEL_COLORS = {
  info: "#94A3B8",
  ok:   "#10B981",
  warn: "#F59E0B",
  err:  "#EF4444",
  api:  "#22D3EE",
  llm:  "#A855F7",
  dbg:  "#64748B",
};

function emit(level, msg, meta) {
  const entry = { id: ++counter, ts: Date.now(), level, msg, meta };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);

  // Console (toujours, même prod — c'est utile)
  const tag = `%c[doria:${level}]%c ${msg}`;
  const styleTag = `color: ${LEVEL_COLORS[level] || "#94A3B8"}; font-weight: bold`;
  const styleMsg = `color: inherit`;
  const fn = level === "err" ? console.error : level === "warn" ? console.warn : console.log;
  if (meta !== undefined) fn(tag, styleTag, styleMsg, meta);
  else fn(tag, styleTag, styleMsg);

  for (const cb of subscribers) {
    try { cb(entry); } catch (e) { /* swallow */ }
  }
  scheduleSave();
  return entry;
}

export const logInfo = (msg, meta) => emit("info", msg, meta);
export const logOk   = (msg, meta) => emit("ok",   msg, meta);
export const logWarn = (msg, meta) => emit("warn", msg, meta);
export const logErr  = (msg, meta) => emit("err",  msg, meta);
export const logApi  = (msg, meta) => emit("api",  msg, meta);
export const logLlm  = (msg, meta) => emit("llm",  msg, meta);
export const logDbg  = (msg, meta) => emit("dbg",  msg, meta);

export function subscribeLogs(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getLogs() {
  return buffer.slice();
}

export function clearLogs() {
  buffer.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const cb of subscribers) cb({ id: ++counter, ts: Date.now(), level: "info", msg: "(logs effacés)" });
}

export function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
