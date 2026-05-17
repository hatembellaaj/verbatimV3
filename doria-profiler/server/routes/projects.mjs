// Routes projets — sauvegarde, listing, chargement.
//
// GET    /api/projects                  → liste (résumé)
// GET    /api/projects/:id              → projet complet (taxo + verbatims + classifications)
// POST   /api/projects                  → crée un projet et persiste tout en transaction
// DELETE /api/projects/:id              → suppression cascade
//
// Le payload de POST contient :
//   {
//     name, contexte, mode ('llm' | 'embed'),
//     category: { name } | null,         // crée la catégorie si inexistante
//     taxo: { categories: [{name, subCategories, anchors?, subAnchors?}] },
//     stats: {...},
//     verbatims: [
//       { external_id?, text, metadata?, categories: [
//         { cluster_label, subcluster_label, confidence_cluster, confidence_subcluster, scores? }
//       ]}
//     ]
//   }

import express from "express";
import { pool, withTransaction } from "../db/pool.mjs";

export const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id, p.name, p.contexte, p.mode, p.status, p.stats, p.created_at, p.updated_at,
        c.id AS category_id, c.name AS category_name,
        (SELECT COUNT(*) FROM verbatims WHERE project_id = p.id)::INT AS verbatims_count
      FROM projects p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.updated_at DESC
    `);
    res.json({ projects: rows });
  } catch (e) {
    console.error("[projects] list:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const proj = await pool.query(`
      SELECT p.*, c.name AS category_name
      FROM projects p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = $1
    `, [id]);
    if (!proj.rowCount) return res.status(404).json({ error: "Projet introuvable" });

    const verb = await pool.query(`
      SELECT id, external_id, text, metadata
      FROM verbatims WHERE project_id = $1 ORDER BY id
    `, [id]);
    const verbIds = verb.rows.map((v) => v.id);

    const cls = verbIds.length
      ? await pool.query(`
          SELECT verbatim_id, cluster_id, subcluster_id, cluster_label, subcluster_label,
                 confidence_cluster, confidence_subcluster, source, scores
          FROM classifications WHERE verbatim_id = ANY($1)
          ORDER BY verbatim_id, confidence_cluster DESC
        `, [verbIds])
      : { rows: [] };

    const clsByVerb = new Map();
    for (const c of cls.rows) {
      if (!clsByVerb.has(c.verbatim_id)) clsByVerb.set(c.verbatim_id, []);
      clsByVerb.get(c.verbatim_id).push(c);
    }
    const verbatims = verb.rows.map((v) => ({
      ...v,
      classifications: clsByVerb.get(v.id) || [],
    }));

    res.json({ ...proj.rows[0], verbatims });
  } catch (e) {
    console.error("[projects] get:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  const { name, contexte, mode, taxo, stats, verbatims = [] } = body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name requis" });

  try {
    const projectId = await withTransaction(async (client) => {
      // ─── Catégorie (créée si fournie et inexistante) ─────────────────
      let categoryId = null;
      if (body.category?.name) {
        const catName = String(body.category.name).trim();
        const r = await client.query(`
          INSERT INTO categories (name, description)
          VALUES ($1, $2)
          ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
          RETURNING id
        `, [catName, body.category.description || null]);
        categoryId = r.rows[0].id;

        // Synchronise les clusters/sous-clusters de la catégorie + leurs ancres
        // depuis la taxo. Idempotent grâce aux UNIQUE indexes (migration 002).
        for (let ci = 0; ci < (taxo?.categories || []).length; ci++) {
          const c = taxo.categories[ci];
          const cR = await client.query(`
            INSERT INTO clusters (category_id, name, description, position)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (category_id, name) DO UPDATE SET position = EXCLUDED.position
            RETURNING id
          `, [categoryId, c.name, c.description || null, ci]);
          const clusterId = cR.rows[0].id;

          // Ancres niveau cluster
          for (const text of (c.anchors || [])) {
            const txt = String(text || "").trim();
            if (!txt) continue;
            await client.query(`
              INSERT INTO anchors (cluster_id, text, source)
              VALUES ($1, $2, 'llm')
              ON CONFLICT (cluster_id, text) WHERE cluster_id IS NOT NULL DO NOTHING
            `, [clusterId, txt]);
          }

          // Sous-clusters + ancres niveau sous-cluster
          for (let si = 0; si < (c.subCategories || []).length; si++) {
            const subName = c.subCategories[si];
            const sR = await client.query(`
              INSERT INTO subclusters (cluster_id, name, position)
              VALUES ($1, $2, $3)
              ON CONFLICT (cluster_id, name) DO UPDATE SET position = EXCLUDED.position
              RETURNING id
            `, [clusterId, subName, si]);
            const subId = sR.rows[0].id;
            const subAnchorsList = (c.subAnchors || {})[subName] || [];
            for (const text of subAnchorsList) {
              const txt = String(text || "").trim();
              if (!txt) continue;
              await client.query(`
                INSERT INTO anchors (subcluster_id, text, source)
                VALUES ($1, $2, 'llm')
                ON CONFLICT (subcluster_id, text) WHERE subcluster_id IS NOT NULL DO NOTHING
              `, [subId, txt]);
            }
          }
        }
      }

      // ─── Projet ──────────────────────────────────────────────────────
      const pR = await client.query(`
        INSERT INTO projects (category_id, name, contexte, mode, status, taxo_snapshot, stats)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        categoryId,
        String(name).trim(),
        contexte || null,
        mode || null,
        verbatims.length > 0 ? "classified" : "draft",
        taxo ? JSON.stringify(taxo) : null,
        stats ? JSON.stringify(stats) : null,
      ]);
      const projectId = pR.rows[0].id;

      // ─── Verbatims + classifications (batch) ─────────────────────────
      // Carto label → cluster_id / subcluster_id (si catégorie en DB)
      const labelToClusterId = new Map();
      const labelToSubclusterId = new Map();
      if (categoryId) {
        const cMap = await client.query(`
          SELECT id, name FROM clusters WHERE category_id = $1
        `, [categoryId]);
        for (const c of cMap.rows) labelToClusterId.set(c.name, c.id);
        if (cMap.rows.length) {
          const sMap = await client.query(`
            SELECT s.id, s.cluster_id, s.name, c.name AS cluster_name
            FROM subclusters s JOIN clusters c ON c.id = s.cluster_id
            WHERE c.category_id = $1
          `, [categoryId]);
          for (const s of sMap.rows) {
            labelToSubclusterId.set(`${s.cluster_name}::${s.name}`, s.id);
          }
        }
      }

      for (const v of verbatims) {
        const vR = await client.query(`
          INSERT INTO verbatims (project_id, external_id, text, metadata)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [
          projectId,
          v.external_id || null,
          String(v.text || ""),
          v.metadata ? JSON.stringify(v.metadata) : null,
        ]);
        const verbId = vR.rows[0].id;

        for (const lbl of (v.categories || [])) {
          await client.query(`
            INSERT INTO classifications
              (verbatim_id, cluster_id, subcluster_id, cluster_label, subcluster_label,
               confidence_cluster, confidence_subcluster, source, scores)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            verbId,
            labelToClusterId.get(lbl.cluster_label) || null,
            labelToSubclusterId.get(`${lbl.cluster_label}::${lbl.subcluster_label}`) || null,
            lbl.cluster_label || null,
            lbl.subcluster_label || null,
            lbl.confidence_cluster ?? null,
            lbl.confidence_subcluster ?? null,
            lbl.source || "auto",
            lbl.scores ? JSON.stringify(lbl.scores) : null,
          ]);
        }
      }

      return projectId;
    });

    res.status(201).json({ id: projectId });
  } catch (e) {
    console.error("[projects] create:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query("DELETE FROM projects WHERE id = $1", [id]);
    if (!r.rowCount) return res.status(404).json({ error: "Projet introuvable" });
    res.json({ deleted: true });
  } catch (e) {
    console.error("[projects] delete:", e.message);
    res.status(500).json({ error: e.message });
  }
});
