// Helpers généraux

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Fisher-Yates shuffle (cf. spec I.2 — Échantillonnage)
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sample without replacement
export function sample(arr, n) {
  return shuffle(arr).slice(0, Math.min(n, arr.length));
}

// Tente plusieurs formats de date avant fallback Date()
export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s).trim();
  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // DD/MM/YYYY ou DD-MM-YYYY
  m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function monthKey(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Robust JSON extraction from LLM text (often wrapped in ```json ... ``` or with prose around it)
export function parseJSON(text) {
  if (!text) return null;
  // Strip ```json fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Try direct
  try { return JSON.parse(candidate); } catch {}
  // Find first { ... } or [ ... ] balanced
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function downloadCSV(filename, rows) {
  // UTF-8 BOM pour compat Excel
  const BOM = "\uFEFF";
  const csv = rows.map(r => r.map(cellEscape).join(",")).join("\n");
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes(";")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// p-limit minimal (concurrency control)
export function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
