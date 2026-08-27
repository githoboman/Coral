/**
 * Migration runner. Applies `migrations/*.sql` in filename order, once each,
 * inside a transaction, guarded by an advisory lock so concurrent boots do
 * not race. Forward-only: rollbacks are a deploy concern, and migrations must
 * stay backward-compatible so a rollback never strands the schema (spec §11.3).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getPool, withTransaction } from "./pool.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
/** Arbitrary but fixed: identifies the Corral migration lock. */
const ADVISORY_LOCK_KEY = 8_246_113_477_001n;

export interface AppliedMigration {
  readonly name: string;
  readonly alreadyApplied: boolean;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function runMigrations(): Promise<AppliedMigration[]> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS corral_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const client = await pool.connect();
  const results: AppliedMigration[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY.toString()]);
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM corral_migrations")).rows.map((r) => r.name));

    for (const name of migrationFiles()) {
      if (done.has(name)) {
        results.push({ name, alreadyApplied: true });
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      await withTransaction(async (tx) => {
        await tx.query(sql);
        await tx.query("INSERT INTO corral_migrations (name) VALUES ($1)", [name]);
      });
      results.push({ name, alreadyApplied: false });
    }
    return results;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY.toString()]).catch(() => undefined);
    client.release();
  }
}
