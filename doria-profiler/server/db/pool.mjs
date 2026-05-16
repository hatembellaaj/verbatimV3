// Pool PG centralisé — réutilisé par tous les modules de routes.
// Connexion via DATABASE_URL (postgres://user:pass@host:port/db) ou via vars séparées.

import pg from "pg";

const { Pool } = pg;

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || "db",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "doria",
      password: process.env.DB_PASSWORD || "doria",
      database: process.env.DB_NAME || "doria",
    };

export const pool = new Pool({
  ...config,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[db] Pool error:", err.message);
});

// Petit helper pour les transactions
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
