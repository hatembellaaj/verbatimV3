// Routes catégories — CRUD minimal.
// GET  /api/categories            → liste avec count clusters/projets
// GET  /api/categories/:id        → détail avec clusters et sous-clusters
// POST /api/categories            → création ({ name, description })
// DELETE /api/categories/:id      → suppression (cascade clusters + ancres)

import express from "express";
import { pool } from "../db/pool.mjs";

export const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.name, c.description, c.created_at, c.updated_at,
        (SELECT COUNT(*) FROM clusters WHERE category_id = c.id)::INT AS clusters_count,
        (SELECT COUNT(*) FROM subclusters s
            JOIN clusters cl ON cl.id = s.cluster_id WHERE cl.category_id = c.id)::INT AS subclusters_count,
        (SELECT COUNT(*) FROM projects WHERE category_id = c.id)::INT AS projects_count,
        (SELECT COUNT(*) FROM anchors a
            LEFT JOIN clusters cl ON cl.id = a.cluster_id
            LEFT JOIN subclusters s ON s.id = a.subcluster_id
            LEFT JOIN clusters cls ON cls.id = s.cluster_id
            WHERE cl.category_id = c.id OR cls.category_id = c.id)::INT AS anchors_count
      FROM categories c
      ORDER BY c.name
    `);
    res.json({ categories: rows });
  } catch (e) {
    console.error("[categories] list:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/categories/:id  → renommer / mettre à jour la description
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name requis" });
    }
    const r = await pool.query(`
      UPDATE categories
      SET name = $1, description = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [String(name).trim(), description || null, id]);
    if (!r.rowCount) return res.status(404).json({ error: "Catégorie introuvable" });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Une autre catégorie porte déjà ce nom" });
    console.error("[categories] patch:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/categories/:id/projects  → liste les projets de cette catégorie
router.get("/:id/projects", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.status, p.mode, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM verbatims WHERE project_id = p.id)::INT AS verbatims_count
      FROM projects p
      WHERE p.category_id = $1
      ORDER BY p.updated_at DESC
    `, [id]);
    res.json({ projects: rows });
  } catch (e) {
    console.error("[categories] projects:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = await pool.query("SELECT * FROM categories WHERE id = $1", [id]);
    if (!cat.rowCount) return res.status(404).json({ error: "Catégorie introuvable" });

    const clusters = await pool.query(`
      SELECT id, name, description, position
      FROM clusters WHERE category_id = $1 ORDER BY position, name
    `, [id]);
    const clusterIds = clusters.rows.map((c) => c.id);
    const subs = clusterIds.length
      ? await pool.query(`
          SELECT id, cluster_id, name, description, position
          FROM subclusters WHERE cluster_id = ANY($1) ORDER BY position, name
        `, [clusterIds])
      : { rows: [] };
    const subIds = subs.rows.map((s) => s.id);

    // ─── Ancres : cluster-level + subcluster-level ─────────────────────
    const clusterAnchors = clusterIds.length
      ? await pool.query(`
          SELECT cluster_id, text, source FROM anchors
          WHERE cluster_id = ANY($1) AND subcluster_id IS NULL
          ORDER BY id
        `, [clusterIds])
      : { rows: [] };
    const subAnchors = subIds.length
      ? await pool.query(`
          SELECT subcluster_id, text, source FROM anchors
          WHERE subcluster_id = ANY($1)
          ORDER BY id
        `, [subIds])
      : { rows: [] };

    const anchorsByCluster = {};
    for (const a of clusterAnchors.rows) {
      (anchorsByCluster[a.cluster_id] ||= []).push(a.text);
    }
    const anchorsBySubcluster = {};
    for (const a of subAnchors.rows) {
      (anchorsBySubcluster[a.subcluster_id] ||= []).push(a.text);
    }

    const grouped = clusters.rows.map((c) => ({
      ...c,
      anchors: anchorsByCluster[c.id] || [],
      subclusters: subs.rows
        .filter((s) => s.cluster_id === c.id)
        .map((s) => ({ ...s, anchors: anchorsBySubcluster[s.id] || [] })),
    }));
    res.json({ ...cat.rows[0], clusters: grouped });
  } catch (e) {
    console.error("[categories] get:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/categories/:id/taxo
// Retourne la catégorie au FORMAT DE LA TAXO frontend :
//   { categories: [{ name, subCategories: [], anchors: [], subAnchors: {} }] }
// Utilisé par le bouton "Charger depuis la base" dans PhaseDiscover.
// ─────────────────────────────────────────────────────────────────────────
router.get("/:id/taxo", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = await pool.query("SELECT * FROM categories WHERE id = $1", [id]);
    if (!cat.rowCount) return res.status(404).json({ error: "Catégorie introuvable" });

    const clusters = await pool.query(`
      SELECT id, name FROM clusters WHERE category_id = $1 ORDER BY position, name
    `, [id]);
    const clusterIds = clusters.rows.map((c) => c.id);
    const subs = clusterIds.length
      ? await pool.query(`
          SELECT id, cluster_id, name FROM subclusters
          WHERE cluster_id = ANY($1) ORDER BY position, name
        `, [clusterIds])
      : { rows: [] };
    const subIds = subs.rows.map((s) => s.id);

    const clusterAnchors = clusterIds.length
      ? await pool.query(`
          SELECT cluster_id, text FROM anchors
          WHERE cluster_id = ANY($1) AND subcluster_id IS NULL ORDER BY id
        `, [clusterIds])
      : { rows: [] };
    const subAnchors = subIds.length
      ? await pool.query(`
          SELECT subcluster_id, text FROM anchors
          WHERE subcluster_id = ANY($1) ORDER BY id
        `, [subIds])
      : { rows: [] };

    const anchorsByCluster = {};
    for (const a of clusterAnchors.rows) {
      (anchorsByCluster[a.cluster_id] ||= []).push(a.text);
    }
    const subAnchorsByClusterAndName = {};
    const subById = Object.fromEntries(subs.rows.map((s) => [s.id, s]));
    for (const a of subAnchors.rows) {
      const sub = subById[a.subcluster_id];
      if (!sub) continue;
      (subAnchorsByClusterAndName[sub.cluster_id] ||= {});
      (subAnchorsByClusterAndName[sub.cluster_id][sub.name] ||= []).push(a.text);
    }

    const categories = clusters.rows.map((c) => ({
      name: c.name,
      subCategories: subs.rows.filter((s) => s.cluster_id === c.id).map((s) => s.name),
      anchors: anchorsByCluster[c.id] || [],
      subAnchors: subAnchorsByClusterAndName[c.id] || {},
    }));

    res.json({
      category: cat.rows[0],
      taxo: { categories },
    });
  } catch (e) {
    console.error("[categories] taxo:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name requis" });
    }
    const { rows } = await pool.query(`
      INSERT INTO categories (name, description) VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = NOW()
      RETURNING *
    `, [String(name).trim(), description || null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("[categories] create:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    if (!r.rowCount) return res.status(404).json({ error: "Catégorie introuvable" });
    res.json({ deleted: true });
  } catch (e) {
    console.error("[categories] delete:", e.message);
    res.status(500).json({ error: e.message });
  }
});
