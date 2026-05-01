// CSV parsing + auto-mapping selon spec PROFILER v3.0 § I.2
import Papa from "papaparse";

// Regex de la spec — Annexe I.2
export const FIELD_REGEX = {
  verbatim: /verbatim|avis|comment|texte|text|feedback|review/i,
  note: /^note$|score|rating|nps|stars|^star/i,
  date: /date|time|publié|published|created/i,
  profil: /profil|segment|type|categor|venu|qui/i,
  source: /^source$|platform|site|plateforme/i,
  score_fidelite: /fidelite|fidélité|loyalty|ltv|rfm|recurrence/i,
  id_externe: /^id$|id_ext|external|uuid|reference/i,
};

export const DORIA_FIELDS = ["verbatim", "note", "date", "profil", "source", "score_fidelite", "id_externe"];

export function parseCSVText(text) {
  // Auto-detect delimiter (PapaParse handles , ; \t)
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: h => (h || "").trim(),
  });
  return {
    rows: result.data || [],
    fields: result.meta?.fields || [],
    delimiter: result.meta?.delimiter || ",",
    errors: result.errors || [],
  };
}

export function parseCSVFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        // Strip UTF-8 BOM if present
        const cleaned = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
        resolve(parseCSVText(cleaned));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "UTF-8");
  });
}

// Devine le mapping {doriaField -> sourceColumn} via regex sur les noms de colonnes
export function autoMap(columns) {
  const mapping = {};
  for (const field of DORIA_FIELDS) {
    const rx = FIELD_REGEX[field];
    const hit = columns.find(c => rx.test(c));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

// Applique le mapping pour produire le format interne unifié
// → tableau d'objets { id, verbatim, note, date, profil, source, score_fidelite, id_externe, _raw }
export function applyMapping(rows, mapping) {
  return rows.map((r, i) => {
    const out = { id: i, _raw: r };
    for (const f of DORIA_FIELDS) {
      const col = mapping[f];
      out[f] = col && r[col] !== undefined ? String(r[col]).trim() : null;
    }
    // Coerce note to number
    if (out.note != null && out.note !== "") {
      const n = parseFloat(String(out.note).replace(",", "."));
      out.note = isNaN(n) ? null : n;
    } else out.note = null;
    return out;
  }).filter(r => r.verbatim && r.verbatim.length > 3);
}

// Stats descriptives § Chap III.1
export function describeCorpus(items) {
  const total = items.length;
  const exploitable = items.filter(i => i.verbatim && i.verbatim.split(/\s+/).length > 3).length;
  const withNote = items.filter(i => i.note != null).length;
  const withDate = items.filter(i => i.date).length;
  const withProfil = items.filter(i => i.profil).length;
  const withSource = items.filter(i => i.source).length;
  const withFid = items.filter(i => i.score_fidelite).length;
  const notes = items.filter(i => i.note != null).map(i => i.note);
  const avgNote = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
  const avgLen = items.length
    ? Math.round(items.reduce((a, i) => a + (i.verbatim?.split(/\s+/).length || 0), 0) / items.length)
    : 0;
  const noteHist = {};
  notes.forEach(n => {
    const k = Math.round(n);
    noteHist[k] = (noteHist[k] || 0) + 1;
  });
  return {
    total, exploitable, withNote, withDate, withProfil, withSource, withFid,
    avgNote: avgNote ? Math.round(avgNote * 100) / 100 : null,
    avgLen,
    pctExploitable: total ? Math.round((exploitable / total) * 1000) / 10 : 0,
    pctWithNote: total ? Math.round((withNote / total) * 1000) / 10 : 0,
    pctWithDate: total ? Math.round((withDate / total) * 1000) / 10 : 0,
    pctWithProfil: total ? Math.round((withProfil / total) * 1000) / 10 : 0,
    noteHist,
  };
}
