// Migration runner — applique les .sql de db/migrations/ qui n'ont pas encore été appliqués.
// Stratégie minimaliste : une table schema_migrations, et chaque fichier .sql tourne
// dans une transaction. Si tout passe, on note la version.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Attente que Postgres soit prêt — il met quelques secondes à boot la 1ʳᵉ fois.
async function waitForDb(maxRetries = 30, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      if (i === 0) console.log("[migrate] En attente de PostgreSQL…");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("PostgreSQL injoignable après " + maxRetries + " tentatives");
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations() {
  await waitForDb();
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log("[migrate] Aucun dossier migrations/, skip");
      return;
    }
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));

    for (const file of files) {
      const version = path.basename(file, ".sql");
      if (applied.has(version)) {
        console.log(`[migrate] ✓ ${version} (déjà appliquée)`);
        continue;
      }
      console.log(`[migrate] ▶ Application ${version}…`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`[migrate] ✓ ${version} appliquée`);
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`[migrate] ✗ ${version} ÉCHEC : ${e.message}`);
        throw e;
      }
    }
  } finally {
    client.release();
  }
}
