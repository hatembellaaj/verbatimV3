// Client API pour les ressources persistées (catégories, projets).
// Endpoints servis par le service `api` (Node Express) via nginx /api/.

async function http(method, url, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ─── Catégories ────────────────────────────────────────────────────────
export const listCategories  = ()    => http("GET",    "/api/categories");
export const getCategory     = (id)  => http("GET",    `/api/categories/${id}`);
export const createCategory  = (data) => http("POST",  "/api/categories", data);
export const deleteCategory  = (id)  => http("DELETE", `/api/categories/${id}`);

// ─── Projets ──────────────────────────────────────────────────────────
export const listProjects    = ()    => http("GET",    "/api/projects");
export const getProject      = (id)  => http("GET",    `/api/projects/${id}`);
export const createProject   = (data) => http("POST",  "/api/projects", data);
export const deleteProject   = (id)  => http("DELETE", `/api/projects/${id}`);

// ─── Vérification de la disponibilité de la DB ────────────────────────
export async function checkDbReady() {
  try {
    const r = await fetch("/api/health").then((r) => r.json());
    return !!r.db;
  } catch {
    return false;
  }
}

// ─── Helper de construction du payload de sauvegarde ──────────────────
// Convertit l'état runtime (taxo, enriched, contexte, mode) en payload API.
export function buildSavePayload({ name, categoryName, contexte, mode, taxo, enriched, stats }) {
  return {
    name,
    contexte: contexte || null,
    mode: mode || null,
    category: categoryName ? { name: categoryName } : null,
    taxo: taxo ? {
      categories: (taxo.categories || []).map((c) => ({
        name: c.name,
        description: c.description || null,
        subCategories: c.subCategories || [],
        anchors: c.anchors || [],
        subAnchors: c.subAnchors || {},
      })),
      anchorsVersion: taxo.anchorsVersion || null,
    } : null,
    stats: stats || null,
    verbatims: (enriched || []).map((v) => ({
      external_id: v.id != null ? String(v.id) : null,
      text: v.verbatim || "",
      metadata: {
        note: v.note,
        date: v.date,
        profil: v.profil,
        source: v.source,
        psychoProfile: v.psychoProfile,
        pad: v.pad,
        tonality: v.tonality,
        biais: v.biais,
        motivations: v.motivations,
        signaux: v.signaux,
        _classifier: v._classifier,
        _sentenceCount: v._sentenceCount,
      },
      categories: Array.isArray(v.categories) && v.categories.length
        ? v.categories
        : (v.category ? [{
            cluster_label: v.category,
            subcluster_label: v.subCategory || null,
            confidence_cluster: v.confidence_cluster ?? v.confidence ?? null,
            confidence_subcluster: v.confidence_subcluster ?? null,
          }] : []),
    })),
  };
}
