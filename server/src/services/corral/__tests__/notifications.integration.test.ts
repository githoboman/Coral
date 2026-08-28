/**
 * C-703 / FR-10.x — notifications.
 *
 * The two properties that matter are structural, not cosmetic:
 *
 *  - A delivery failure cannot reach the execution path (FR-10.5). The
 *    execution path writes a row; nothing it does can await an SMTP server.
 *  - A run produces at most one message per digest window (FR-10.3), enforced
 *    by a unique index rather than by a query being careful.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../db/migrate.js";
import { closePool, query } from "../db/pool.js";
import { dispatchDue, renderText, type Channels } from "../notifications/dispatch.js";
import {
  channelsFor,
  due,
  markFailed,
  notifiedThresholds,
  notify,
  recordThreshold,
  setPrefs,
  suppressForSession,
} from "../notifications/outbox.js";
import {
  budgetDraft,
  crossedThresholds,
  expiryDraft,
  failureDraft,
  pausedDraft,
  revokeDraft,
  successDraft,
} from "../notifications/triggers.js";
import { createSession, markActive } from "../sessions/repository.js";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const OWNER = `0x${"a1".repeat(20)}`;
const ctx = { sessionId: "", appBaseUrl: "https://corral.example" };

// ── Copy: unit, no database ─────────────────────────────────────────────────

describe("message copy (FR-10.4)", () => {
  const c = { sessionId: "s1", executionId: "e1", appBaseUrl: "https://corral.example" };

  it("every message links to the specific thing it is about", () => {
    expect(successDraft(c, "Bought WETH").link).toContain("/activity/e1");
    expect(budgetDraft(c, "USDC", 80).link).toContain("/agents/s1");
  });

  it("says whether action is needed, and a retrying failure does not need any", () => {
    expect(failureDraft(c, "RPC_TIMEOUT", true).actionRequired).toBe(false);
    expect(failureDraft(c, "POLICY_BUDGET_EXCEEDED", false).actionRequired).toBe(true);
  });

  it("a pause always needs action — a paused agent stays paused", () => {
    // A user who does not know this assumes it is still working.
    expect(pausedDraft(c, "the module set changed").actionRequired).toBe(true);
  });

  it("never puts a raw error code or revert string in the body", () => {
    const body = failureDraft(c, "POLICY_TARGET_NOT_ALLOWED", false).body;
    expect(body).not.toContain("POLICY_TARGET_NOT_ALLOWED");
    expect(body).not.toContain("0x");
  });

  it("reassures that money did not move when it did not", () => {
    expect(failureDraft(c, "SIMULATION_REVERT", true).body.toLowerCase()).toContain("no money moved");
    expect(pausedDraft(c, "x").body.toLowerCase()).toContain("no money has moved");
  });

  it("the revoke message states what revoke does NOT do (FR-8.4)", () => {
    const body = revokeDraft(c).body.toLowerCase();
    expect(body).toContain("does not undo");
    expect(body).toContain("does not move any money");
  });

  it("success is delayed so a run produces one message, failure is immediate", () => {
    expect(successDraft(c, "x").delayMs).toBeGreaterThan(0);
    expect(failureDraft(c, "RPC_TIMEOUT", true).delayMs).toBe(0);
  });

  it("a full budget is action-required; a milestone is not", () => {
    expect(budgetDraft(c, "USDC", 50).actionRequired).toBe(false);
    expect(budgetDraft(c, "USDC", 100).actionRequired).toBe(true);
  });

  it("expiry copy distinguishes 'will stop' from 'has stopped'", () => {
    expect(expiryDraft(c, 72).subject).toContain("72 hours");
    expect(expiryDraft(c, null).subject).toContain("has ended");
  });

  it("renders link and action prompt into the plain-text form", () => {
    const text = renderText({ subject: "S", body: "B", link: "https://x", action_required: true });
    expect(text).toContain("https://x");
    expect(text).toContain("needs you to take a look");
  });
});

describe("budget thresholds", () => {
  it("reports a crossing exactly at the boundary", () => {
    // Integer basis points: 80% of 1000 is 800, and 800 is a crossing.
    expect(crossedThresholds(800n, 1000n, [])).toEqual([50, 80]);
  });

  it("does not repeat a threshold already announced", () => {
    expect(crossedThresholds(800n, 1000n, [50, 80])).toEqual([]);
  });

  it("reports the full budget as 100", () => {
    expect(crossedThresholds(1000n, 1000n, [50, 80])).toEqual([100]);
  });

  it("is silent on a zero limit rather than dividing by it", () => {
    expect(crossedThresholds(5n, 0n, [])).toEqual([]);
  });

  it("survives 18-decimal magnitudes without a float", () => {
    const limit = 1_000_000_000_000_000_000n;
    expect(crossedThresholds(limit / 2n, limit, [])).toEqual([50]);
  });
});

// ── Outbox and dispatch ─────────────────────────────────────────────────────

describe.skipIf(!TEST_DB)("notification outbox", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["DATABASE_SCHEMA"] = "corral_test_notify";
    await query("CREATE SCHEMA IF NOT EXISTS corral_test_notify");
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query(
      "TRUNCATE corral_budget_notices, corral_notifications, corral_notification_prefs, corral_events, corral_indexer_cursor, corral_relayer_txs, corral_anomalies, corral_signer_audit, corral_jobs, corral_executions, corral_budget_mirror, corral_strategies, corral_sessions CASCADE",
    );
    const now = Math.floor(Date.now() / 1000);
    const s = await createSession({
      chainId: 84532,
      account: `0x${"c3".repeat(20)}`,
      owner: OWNER,
      agentSigner: `0x${"d4".repeat(20)}`,
      permissionId: `0x${"e5".repeat(32)}`,
      policy: {},
      validAfter: now - 60,
      validUntil: now + 86_400,
    });
    await markActive(s.id, `0x${"0".repeat(64)}`);
    ctx.sessionId = s.id;
  });

  it("defaults to email only — Telegram is opt-in (FR-10.1)", async () => {
    expect(await channelsFor(OWNER)).toEqual(["EMAIL"]);
  });

  it("uses both channels once the owner enables Telegram", async () => {
    await setPrefs({ owner: OWNER, email: "a@b.c", telegramChatId: "123", emailEnabled: true, telegramEnabled: true });
    expect(await channelsFor(OWNER)).toEqual(["EMAIL", "TELEGRAM"]);
  });

  it("respects a channel being turned off", async () => {
    await setPrefs({ owner: OWNER, email: "a@b.c", emailEnabled: false, telegramEnabled: false });
    expect(await channelsFor(OWNER)).toEqual([]);
  });

  it("collapses repeated messages with the same digest key (FR-10.3)", async () => {
    // A weekly DCA must never produce more than one message per run, however
    // many internal events that run generates.
    const draft = successDraft({ ...ctx, executionId: "e1" }, "Bought WETH");
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft });
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft });
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft });
    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_notifications`);
    expect(rows[0]?.n).toBe("1");
  });

  it("keeps distinct failures as distinct messages", async () => {
    await notify({
      owner: OWNER,
      sessionId: ctx.sessionId,
      draft: failureDraft({ ...ctx, executionId: "e1" }, "RPC_TIMEOUT", true),
    });
    await notify({
      owner: OWNER,
      sessionId: ctx.sessionId,
      draft: failureDraft({ ...ctx, executionId: "e2" }, "RPC_TIMEOUT", true),
    });
    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM corral_notifications`);
    expect(rows[0]?.n).toBe("2");
  });

  it("a delayed success is not due immediately", async () => {
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: successDraft(ctx, "x") });
    expect(await due()).toHaveLength(0);
  });

  it("an immediate failure is due at once", async () => {
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: failureDraft(ctx, "RPC_TIMEOUT", true) });
    expect(await due()).toHaveLength(1);
  });

  it("records a budget threshold once, not once per reconciliation", async () => {
    await recordThreshold(ctx.sessionId, `0x${"f6".repeat(20)}`, 80);
    await recordThreshold(ctx.sessionId, `0x${"f6".repeat(20)}`, 80);
    expect(await notifiedThresholds(ctx.sessionId, `0x${"f6".repeat(20)}`)).toEqual([80]);
  });

  it("suppresses pending messages on revoke, except the revoke notice itself", async () => {
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: successDraft(ctx, "x") });
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: revokeDraft(ctx) });
    expect(await suppressForSession(ctx.sessionId)).toBe(1);
    const remaining = await query<{ trigger: string }>(
      `SELECT trigger FROM corral_notifications WHERE status = 'PENDING'`,
    );
    expect(remaining.map((r) => r.trigger)).toEqual(["REVOKE_CONFIRMED"]);
  });

  it("backs off a failed delivery and gives up after the attempt limit", async () => {
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: failureDraft(ctx, "RPC_TIMEOUT", true) });
    const row = (await due())[0];
    expect(row).toBeDefined();
    for (let i = 0; i < 5; i++) await markFailed(row!.id, "smtp down");
    const after = await query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM corral_notifications WHERE id = $1`,
      [row!.id],
    );
    expect(after[0]?.status).toBe("FAILED");
  });
});

describe.skipIf(!TEST_DB)("dispatch", () => {
  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["DATABASE_SCHEMA"] = "corral_test_notify";
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await query("TRUNCATE corral_notifications CASCADE");
    const now = Math.floor(Date.now() / 1000);
    const s = await createSession({
      chainId: 84532,
      account: `0x${"c3".repeat(20)}`,
      owner: OWNER,
      agentSigner: `0x${"d4".repeat(20)}`,
      permissionId: `0x${"e5".repeat(32)}`,
      policy: {},
      validAfter: now - 60,
      validUntil: now + 86_400,
    });
    ctx.sessionId = s.id;
    await notify({ owner: OWNER, sessionId: ctx.sessionId, draft: failureDraft(ctx, "RPC_TIMEOUT", true) });
  });

  const target = { email: "user@example.com", telegramChatId: null };

  it("sends and marks the message sent", async () => {
    const sentTo: string[] = [];
    const channels: Channels = {
      EMAIL: async (m) => {
        sentTo.push(m.to);
        return true;
      },
    };
    const r = await dispatchDue({ channels, resolve: async () => target });
    expect(r.sent).toBe(1);
    expect(sentTo).toEqual(["user@example.com"]);
  });

  it("a channel that throws is a delivery failure, never an exception to the caller", async () => {
    // This is the whole of FR-10.5: nothing here can propagate upward into an
    // execution path.
    const channels: Channels = {
      EMAIL: async () => {
        throw new Error("smtp exploded");
      },
    };
    await expect(dispatchDue({ channels, resolve: async () => target })).resolves.toMatchObject({ failed: 1 });
  });

  it("a channel returning false is a failure, not a silent success", async () => {
    const channels: Channels = { EMAIL: async () => false };
    const r = await dispatchDue({ channels, resolve: async () => target });
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
  });

  it("gives up immediately when there is nowhere to send", async () => {
    // Retrying a message with no address is a queue that never drains.
    const channels: Channels = { EMAIL: async () => true };
    const r = await dispatchDue({ channels, resolve: async () => ({ email: null, telegramChatId: null }) });
    expect(r.undeliverable).toBe(1);
    const rows = await query<{ status: string }>(`SELECT status FROM corral_notifications`);
    expect(rows[0]?.status).toBe("FAILED");
  });

  it("gives up immediately when the channel is not configured at all", async () => {
    const r = await dispatchDue({ channels: {}, resolve: async () => target });
    expect(r.undeliverable).toBe(1);
  });

  it("a failing recipient lookup does not take down the batch", async () => {
    const channels: Channels = { EMAIL: async () => true };
    await expect(
      dispatchDue({
        channels,
        resolve: async () => {
          throw new Error("directory down");
        },
      }),
    ).resolves.toMatchObject({ failed: 1 });
  });
});
