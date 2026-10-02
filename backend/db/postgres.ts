/**
 * backend/db/postgres.ts
 *
 * Sequelize connection pool targeting PostgreSQL 16+.
 *
 * Exports:
 *   pgSequelize   â€” the shared Sequelize instance for PG models
 *   initPostgres() â€” call once at startup; authenticates + creates extension
 *
 * Configuration is read from the `env` object in `../config/env.ts`.
 * validateEnv() must have been called before this module is used.
 */

import { QueryTypes, Sequelize } from "sequelize";
import { env } from "../config/env.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// â”€â”€ SSL options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildPgSslOptions(): object | undefined {
  if (!env.pgSsl) return undefined;
  const caPath = env.pgSslCa;
  if (!caPath) {
    console.error("[postgres] PG_SSL_CA required when PG_SSL=true");
    process.exit(1);
  }
  try {
    return { ca: readFileSync(caPath) };
  } catch {
    console.error("[postgres] Cannot read PG SSL CA file");
    process.exit(1);
  }
}

// â”€â”€ Sequelize instance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const pgSequelize = new Sequelize({
  dialect: "postgres",
  host: env.pgHost,
  port: env.pgPort,
  username: env.pgUser,
  password: env.pgPassword,
  database: env.pgName,
  logging: false,
  dialectOptions: {
    ssl: buildPgSslOptions() ?? false,
  },
  pool: {
    max: env.pgPoolMax,
    min: 0,
    acquire: 30_000,
    idle: 10_000,
  },
  define: { underscored: true, timestamps: false },
});

// â”€â”€ initPostgres â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Authenticate the PostgreSQL connection pool.
 * Enables the pgcrypto extension for gen_random_uuid().
 * Sets a 10-second timeout.
 */
export async function initPostgres(): Promise<void> {
  const timeout = setTimeout(() => {
    console.error("[postgres] Connection timeout after 10s");
    process.exit(1);
  }, 10_000);

  try {
    await pgSequelize.authenticate();
    clearTimeout(timeout);

    await applyPostgresMigrations();

    console.log("[postgres] Connected; database migrations are current");
  } catch (err) {
    clearTimeout(timeout);
    console.error("[postgres] Startup error:", err);
    process.exit(1);
  }
}

/** Apply checked-in SQL migrations once, recording each successful migration. */
async function applyPostgresMigrations(): Promise<void> {
  await pgSequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationName = "002_postgres_schema.sql";
  // Resolve from the application root so this works in both tsx development
  // and the bundled production server.
  const migrationPath = resolve(process.cwd(), "backend", "db", "migrations", migrationName);
  const sql = readFileSync(migrationPath, "utf8");
  const applied = await pgSequelize.query<{ name: string }>(
    "SELECT name FROM schema_migrations WHERE name = $1",
    { bind: [migrationName], type: QueryTypes.SELECT }
  );
  if (applied.length > 0) return;

  await pgSequelize.transaction(async (transaction) => {
    // The checked-in schema migration contains ordinary SQL statements and no
    // procedural blocks, so semicolon-delimited execution keeps the entire
    // migration atomic while avoiding multi-statement prepared queries.
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      await pgSequelize.query(statement, { transaction });
    }

    await pgSequelize.query(
      "INSERT INTO schema_migrations (name) VALUES ($1)",
      { bind: [migrationName], transaction }
    );
  });
}
