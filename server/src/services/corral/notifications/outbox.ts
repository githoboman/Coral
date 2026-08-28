/**
 * The notification outbox (C-703, FR-10.5).
 *
 * The execution path writes a row and stops. It never opens an SMTP
 * connection, never waits on Telegram, and never sees a delivery error —
 * because FR-10.5 promises that a notification failure cannot block or delay
 * an execution, and the only way to actually promise that is to make delivery
 * somebody else's job.
 *
 * The digest guarantee (FR-10.3) is a unique partial index, not a query: one
 * PENDING row per (digest key, channel). A second event that would produce the
 * same message collapses into the first rather than queueing behind it.
 */
import { isUniqueViolation, query } from "../db/pool.js";
import type { NotificationDraft } from "./triggers.js";

export type Channel = "EMAIL" | "TELEGRAM";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED" | "SUPPRESSED";

export interface NotificationRow {
  readonly id: string;
  readonly session_id: string | null;
  readonly execution_id: string | null;
  readonly owner: string;
  readonly trigger: string;
  readonly channel: Channel;
  readonly subject: string;
  readonly body: string;
  readonly link: string | null;
  readonly action_required: boolean;
  readonly digest_key: string;
  readonly status: NotificationStatus;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly send_after: Date;
}

export interface Prefs {
  readonly owner: string;
  readonly email: string | null;
  readonly telegram_chat_id: string | null;
  readonly email_enabled: boolean;
  readonly telegram_enabled: boolean;
}

/**
 * Channels to use for this owner.
 *
 * No preferences row means email only — FR-10.1 makes email the MUST channel
 * and Telegram opt-in, and defaulting a user into a chat they never asked for
 * is not a default we get to pick.
 */
export async function channelsFor(owner: string): Promise<Channel[]> {
  const rows = await query<Prefs>(`SELECT * FROM corral_notification_prefs WHERE owner = $1`, [owner.toLowerCase()]);
  const p = rows[0];
  if (!p) return ["EMAIL"];
  const out: Channel[] = [];
  if (p.email_enabled && p.email) out.push("EMAIL");
  if (p.telegram_enabled && p.telegram_chat_id) out.push("TELEGRAM");
  return out;
}

export async function getPrefs(owner: string): Promise<Prefs | null> {
  const rows = await query<Prefs>(`SELECT * FROM corral_notification_prefs WHERE owner = $1`, [owner.toLowerCase()]);
  return rows[0] ?? null;
}

export async function setPrefs(input: {
  owner: string;
  email?: string | null;
  telegramChatId?: string | null;
  emailEnabled?: boolean;
  telegramEnabled?: boolean;
}): Promise<void> {
  await query(
    `INSERT INTO corral_notification_prefs (owner, email, telegram_chat_id, email_enabled, telegram_enabled, updated_at)
     VALUES ($1, $2, $3, coalesce($4, true), coalesce($5, false), now())
     ON CONFLICT (owner) DO UPDATE
       SET email = coalesce(EXCLUDED.email, corral_notification_prefs.email),
           telegram_chat_id = coalesce(EXCLUDED.telegram_chat_id, corral_notification_prefs.telegram_chat_id),
           email_enabled = EXCLUDED.email_enabled,
           telegram_enabled = EXCLUDED.telegram_enabled,
           updated_at = now()`,
    [
      input.owner.toLowerCase(),
      input.email ?? null,
      input.telegramChatId ?? null,
      input.emailEnabled ?? null,
      input.telegramEnabled ?? null,
    ],
  );
}

/**
 * Queue a draft on every channel the owner has enabled.
 *
 * Returns the rows actually created. A collapsed duplicate is not an error and
 * not a failure — it is the digest working.
 */
export async function notify(input: {
  readonly owner: string;
  readonly sessionId: string | null;
  readonly executionId?: string | null;
  readonly draft: NotificationDraft;
}): Promise<NotificationRow[]> {
  const channels = await channelsFor(input.owner);
  const created: NotificationRow[] = [];

  for (const channel of channels) {
    try {
      const rows = await query<NotificationRow>(
        `INSERT INTO corral_notifications
           (session_id, execution_id, owner, trigger, channel, subject, body, link, action_required, digest_key, send_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))
         RETURNING *`,
        [
          input.sessionId,
          input.executionId ?? null,
          input.owner.toLowerCase(),
          input.draft.trigger,
          channel,
          input.draft.subject,
          input.draft.body,
          input.draft.link,
          input.draft.actionRequired,
          input.draft.digestKey,
          input.draft.delayMs / 1000,
        ],
      );
      const row = rows[0];
      if (row) created.push(row);
    } catch (e) {
      // A pending message with this digest key already exists. That is the
      // point of the index, not a problem to report.
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return created;
}

/** Messages due to go out. */
export async function due(limit = 50): Promise<NotificationRow[]> {
  return query<NotificationRow>(
    `SELECT * FROM corral_notifications
      WHERE status = 'PENDING' AND send_after <= now()
      ORDER BY send_after
      LIMIT $1`,
    [limit],
  );
}

export async function markSent(id: string): Promise<void> {
  await query(`UPDATE corral_notifications SET status = 'SENT', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [
    id,
  ]);
}

/**
 * A delivery failure.
 *
 * Bounded retries, then FAILED and forgotten. A notification that keeps
 * retrying forever is a queue that never drains, and the user has by then
 * either noticed or not.
 */
export async function markFailed(id: string, error: string, maxAttempts = 5): Promise<void> {
  await query(
    `UPDATE corral_notifications
        SET attempts = attempts + 1,
            last_error = $2,
            status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END,
            send_after = now() + make_interval(secs => least(600, power(2, attempts + 1)::int * 30))
      WHERE id = $1`,
    [id, error.slice(0, 500), maxAttempts],
  );
}

/** Suppress everything pending for a session — used when it is revoked. */
export async function suppressForSession(sessionId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE corral_notifications SET status = 'SUPPRESSED'
      WHERE session_id = $1 AND status = 'PENDING' AND trigger <> 'REVOKE_CONFIRMED'
      RETURNING id`,
    [sessionId],
  );
  return rows.length;
}

/** Which budget thresholds have already been announced for a session's asset. */
export async function notifiedThresholds(sessionId: string, asset: string): Promise<number[]> {
  const rows = await query<{ threshold_pct: number }>(
    `SELECT threshold_pct FROM corral_budget_notices WHERE session_id = $1 AND asset = $2`,
    [sessionId, asset.toLowerCase()],
  );
  return rows.map((r) => r.threshold_pct);
}

/** Record a crossing so it is announced once, not once per reconciliation. */
export async function recordThreshold(sessionId: string, asset: string, pct: number): Promise<void> {
  await query(
    `INSERT INTO corral_budget_notices (session_id, asset, threshold_pct) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [sessionId, asset.toLowerCase(), pct],
  );
}
