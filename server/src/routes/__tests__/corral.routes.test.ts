/**
 * Corral API surface (spec §6.5). The security-relevant assertions are the
 * negative ones: no endpoint exposes another user's session, and none of them
 * can cause an execution.
 */
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../services/corral/db/migrate.js";
import { closePool, query } from "../../services/corral/db/pool.js";
import { createSession, getSession, markActive } from "../../services/corral/sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const OWNER = `0x${"a1".repeat(20)}`;
const STRANGER = `0x${"b2".repeat(20)}`;

describe.skipIf(!TEST_DB)("corral routes", () => {
  let sessionId = "";
  let account = "";
  let app: Express;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    // The inherited auth stack reads these at module load, so the app is
    // imported dynamically once the test environment is in place.
    process.env["TOKEN_HMAC_SECRET"] ??= "test-only-hmac-secret";
    process.env["DATABASE_SCHEMA"] = "corral_test_routes";
    // Dev auth: the inherited middleware trusts x-dev-wallet in this mode,
    // which is exactly what the local test harness needs.
    process.env["AGENT_DEV_AUTH"] = "true";
    // Mount ONLY the Corral router. The inherited app pulls in chat routes
    // that construct an LLM client at import time, and Corral paths must not
    // depend on those modules (CLAUDE.md §8.4) — testing it standalone both
    // proves and preserves that boundary.
    const express = (await import("express")).default;
    const corralRouter = (await import("../corral.js")).default;
    const standalone = express();
    standalone.use(express.json());
    standalone.use("/api", corralRouter);
    app = standalone;

    await query("CREATE SCHEMA IF NOT EXISTS corral_test_routes");
    await runMigrations();
    await query("TRUNCATE corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE");

    const now = Math.floor(Date.now() / 1000);
    account = `0x${"c3".repeat(20)}`;
    const s = await createSession({
      chainId: 84532,
      account,
      owner: OWNER,
      agentSigner: `0x${"d4".repeat(20)}`,
      permissionId: `0x${"e5".repeat(32)}`,
      policy: { min_output_bps: 9800, budgets: [{ asset: { address: `0x${"f6".repeat(20)}` }, max_total: "500000000" }] },
      validAfter: now - 60,
      validUntil: now + 86_400,
    });
    sessionId = s.id;
    await markActive(sessionId, `0x${"0".repeat(64)}`);
    await query(
      `INSERT INTO corral_budget_mirror (session_id, asset, limit_amount, spent_amount, usage_used, usage_limit)
       VALUES ($1, $2, 500000000, 125000000, 1, 8)`,
      [sessionId, `0x${"f6".repeat(20)}`],
    );
  });

  afterAll(async () => {
    await closePool();
  });

  it("health reports engine wiring without leaking configuration", async () => {
    const res = await request(app).get("/api/corral/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("database");
    expect(JSON.stringify(res.body)).not.toContain("postgres:");
  });

  it("returns the session with budget meters labelled by source and freshness (FR-6.4)", async () => {
    const res = await request(app).get(`/api/corral/sessions/${sessionId}`).set("x-dev-wallet", OWNER);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.budgets[0]).toMatchObject({ limit: "500000000", spent: "125000000", remaining: "375000000", source: "on-chain" });
    expect(res.body.budgets[0].readAt).toBeTruthy();
  });

  it("refuses another wallet's session", async () => {
    const res = await request(app).get(`/api/corral/sessions/${sessionId}`).set("x-dev-wallet", STRANGER);
    expect(res.status).toBe(403);
  });

  it("requires auth", async () => {
    const res = await request(app).get(`/api/corral/sessions/${sessionId}`);
    expect([401, 403]).toContain(res.status);
  });

  it("revoke/prepare disables the signer before returning, and returns a transaction for the OWNER to send", async () => {
    const res = await request(app).post(`/api/corral/sessions/${sessionId}/revoke/prepare`).set("x-dev-wallet", OWNER);
    expect(res.status).toBe(200);
    // The signer is already off — this does not wait for a block.
    expect((await getSession(sessionId))!.signer_disabled).toBe(true);
    expect(res.body.ownerTransaction.to.toLowerCase()).toBe(account.toLowerCase());
    expect(res.body.ownerTransaction.data.startsWith("0x")).toBe(true);
    expect(res.body.disclosure).toContain("does not reverse");
    expect(res.body.fallbackPage).toBe("/revoke");
  });

  it("the public verification view needs no auth and exposes journal entries, not internals (FR-7.6)", async () => {
    const res = await request(app).get(`/api/corral/verify/${account}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].permissionId).toBeTruthy();
    expect(res.body.sessions[0]).toHaveProperty("journal");
    // No signer material, no database ids.
    expect(JSON.stringify(res.body)).not.toContain("agent_signer");
  });

  it("rejects a malformed address on the public view", async () => {
    expect((await request(app).get("/api/corral/verify/not-an-address")).status).toBe(400);
  });
});
