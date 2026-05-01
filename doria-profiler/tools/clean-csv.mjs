// Outil de nettoyage CSV — extrait UNIQUEMENT "Verbatim public" comme verbatim,
// strippe les <br/>, garde les métadonnées utiles, drop les lignes au public vide.
//
// Usage :
//   node tools/clean-csv.mjs <input.csv> [output.csv]
//
// Exemple :
//   node tools/clean-csv.mjs "../avis_pax_12508 2 - Test1000.csv" verbatims-clean.csv

import fs from "node:fs";
import path from "node:path";

// ─── Parser CSV minimaliste (RFC 4180, gère les guillemets et retours à la ligne) ───
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvCell(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes(";")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─── Main ───
const input = process.argv[2];
const output = process.argv[3] || "verbatims-clean.csv";

if (!input) {
  console.error("Usage : node tools/clean-csv.mjs <input.csv> [output.csv]");
  process.exit(1);
}

const text = fs.readFileSync(input, "utf-8");
const rows = parseCSV(text);
if (rows.length < 2) {
  console.error("CSV vide ou 1 seule ligne — abandon.");
  process.exit(1);
}

const header = rows[0];
const find = (name) => {
  const i = header.indexOf(name);
  if (i === -1) console.warn(`⚠ Colonne "${name}" introuvable — sera ignorée`);
  return i;
};
const idxDate = find("Date avis");
const idxStatut = find("Statut");
const idxContexte = find("Êtes-vous venu :");
const idxNote = find("Note globale avis 1");
const idxReco = find("Recommandation Parc Asterix");
const idxPub = find("Verbatim public");
const idxPriv = find("Verbatim privé");

if (idxPub === -1) {
  console.error("✗ Colonne 'Verbatim public' introuvable — abandon.");
  process.exit(1);
}

// Helper : nettoie HTML de base + trim + drop si bruit
function cleanText(s) {
  if (!s) return "";
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function isUseful(s) {
  if (!s) return false;
  if (s.length < 5) return false;
  // Rejette ".", "...", ",", "-" et autres jus de bruit
  if (/^[.,;:\-\s]+$/.test(s)) return false;
  return true;
}

const out = [["id", "date", "statut", "contexte_visite", "note_globale", "recommandation", "verbatim"]];
let kept = 0, droppedEmpty = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (r.every((c) => !c?.trim())) continue; // ligne entièrement vide

  const pub = cleanText(r[idxPub]);
  if (!isUseful(pub)) { droppedEmpty++; continue; }

  out.push([
    String(i),
    idxDate >= 0 ? (r[idxDate] || "") : "",
    idxStatut >= 0 ? (r[idxStatut] || "") : "",
    idxContexte >= 0 ? (r[idxContexte] || "") : "",
    idxNote >= 0 ? (r[idxNote] || "") : "",
    idxReco >= 0 ? (r[idxReco] || "") : "",
    pub,
  ]);
  kept++;
}

const csv = out.map((row) => row.map(csvCell).join(",")).join("\n");
// BOM UTF-8 pour Excel
fs.writeFileSync(output, "\uFEFF" + csv, "utf-8");

console.log(`✓ Fichier nettoyé : ${path.resolve(output)}`);
console.log(`  ${kept} verbatims publics gardés`);
console.log(`  ${droppedEmpty} lignes droppées (Verbatim public vide ou bruit type "." ",")`);
console.log(`  Colonnes finales : id · date · statut · contexte_visite · note_globale · recommandation · verbatim`);
