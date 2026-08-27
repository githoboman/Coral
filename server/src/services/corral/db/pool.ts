/**
 * Postgres access for the Corral execution engine (D19: Supabase Postgres).
 *
 * The database is a MIRROR — it schedules work and prevents double execution;
 * it is never authoritative about money (CLAUDE.md §3). Everything here is
 * therefore free to be rebuilt from chain state.
 *
 * Connection: `DATABASE_URL`. Supabase's direct host is IPv6-only on newer
 * projects, so the pooler URI (`…pooler.supabase.com:5432/6543`) is the
 * portable choice. TLS is required for anything non-local.
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

/** True when a usable `DATABASE_URL` is configured (engine features are off without one). */
export function isDatabaseConfigured(): boolean {
  const url = process.env["DATABASE_URL"];
  if (!url) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "postgres:" || u.protocol === "postgresql:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "host.docker.internal";
}

export function getPool(): Pool {
  if (pool) return pool;
  const url = process.env["DATABASE_URL"];
  if (!isDatabaseConfigured() || !url) {
    throw new Error(
      "DATABASE_URL is not a valid postgres URI. Expected postgresql://user:password@host:port/database " +
        "(Supabase: Project → Connect → session pooler URI, with the database password filled in).",
    );
  }
  const parsed = new URL(url);
  // TLS everywhere except a local dev/test database. `DATABASE_SSL_NO_VERIFY`
  // exists because managed providers sometimes present a chain Node does not
  // trust out of the box; opting out is a conscious, logged choice.
  const ssl = isLocalHost(parsed.hostname)
    ? false
    : { rejectUnauthorized: process.env["DATABASE_SSL_NO_VERIFY"] !== "true" };

  pool = new Pool({
    connectionString: url,
    ssl,
    max: Number(process.env["DATABASE_POOL_MAX"] ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "corral-engine",
  });
  // A pool error must never take the process down silently mid-execution.
  pool.on("error", (err) => {
    console.error("[corral-db] idle client error:", err.message);
  });

  // Optional schema isolation. Production leaves this unset (public schema);
  // parallel test files each set their own so they cannot see — or truncate —
  // one another's rows.
  const schema = process.env["DATABASE_SCHEMA"];
  if (schema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`invalid DATABASE_SCHEMA: ${schema}`);
    pool.on("connect", (client) => {
      void client.query(`SET search_path TO ${schema}, public`);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query<T extends QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params as unknown[]);
  return res.rows;
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the connection is already broken; the pool will discard it
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Postgres unique-violation. Used where a conflict is an expected outcome, not an error. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}
