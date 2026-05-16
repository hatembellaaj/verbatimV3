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
        c.id, c.name, c.description, c.created_at,
        (SELECT COUNT(*) FROM clusters WHERE category_id = c.id)::INT AS clusters_count,
        (SELECT COUNT(*) FROM projects WHERE category_id = c.id)::INT AS projects_count
      FROM categories c
      ORDER BY c.name
    `);
    res.json({ categories: rows });
  } catch (e) {
    console.error("[categories] list:", e.message);
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

    const grouped = clusters.rows.map((c) => ({
      ...c,
      subclusters: subs.rows.filter((s) => s.cluster_id === c.id),
    }));
    res.json({ ...cat.rows[0], clusters: grouped });
  } catch (e) {
    console.error("[categories] get:", e.message);
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
