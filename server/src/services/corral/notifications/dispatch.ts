/**
 * Notification delivery (C-703, FR-10.1, FR-10.5).
 *
 * Channels are injected rather than imported, for the same reason the Corral
 * router is mounted standalone in its tests (§8.4): the inherited email and
 * Telegram services pull in configuration and clients at module load, and an
 * execution path that cannot boot without an SMTP host is an execution path
 * coupled to something it has no business depending on.
 *
 * A channel returning `false` is a delivery failure, not an exception. Nothing
 * in this file is allowed to throw into the caller — the worst outcome of a
 * dead SMTP server is a notification that retries, never an execution that
 * stalls.
 */
import type { JobHandler } from "../jobs/worker.js";
import { due, markFailed, markSent, type Channel, type NotificationRow } from "./outbox.js";

export interface DeliveryTarget {
  readonly email: string | null;
  readonly telegramChatId: string | null;
}

/** One way of getting a message to a person. Returns false on failure. */
export type Deliver = (message: {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly link: string | null;
  readonly actionRequired: boolean;
}) => Promise<boolean>;

export interface Channels {
  readonly EMAIL?: Deliver;
  readonly TELEGRAM?: Deliver;
}

export interface DispatchDeps {
  readonly channels: Channels;
  /** Resolve where to send. Kept injectable so tests need no preferences rows. */
  readonly resolve: (owner: string) => Promise<DeliveryTarget>;
}

function addressFor(target: DeliveryTarget, channel: Channel): string | null {
  return channel === "EMAIL" ? target.email : target.telegramChatId;
}

export interface DispatchResult {
  readonly considered: number;
  readonly sent: number;
  readonly failed: number;
  readonly undeliverable: number;
}

/**
 * Deliver everything due.
 *
 * A message with no address for its channel is marked FAILED immediately
 * rather than retried: retrying a message we have nowhere to send is a queue
 * that never drains and a log that never stops.
 */
export async function dispatchDue(deps: DispatchDeps, limit = 50): Promise<DispatchResult> {
  const rows = await due(limit);
  let sent = 0;
  let failed = 0;
  let undeliverable = 0;

  for (const row of rows) {
    const deliver = deps.channels[row.channel];
    if (!deliver) {
      await markFailed(row.id, `no ${row.channel} channel configured`, 1);
      undeliverable += 1;
      continue;
    }

    let target: DeliveryTarget;
    try {
      target = await deps.resolve(row.owner);
    } catch (e) {
      await markFailed(row.id, e instanceof Error ? e.message : "could not resolve recipient");
      failed += 1;
      continue;
    }

    const to = addressFor(target, row.channel);
    if (!to) {
      await markFailed(row.id, `no ${row.channel} address on file`, 1);
      undeliverable += 1;
      continue;
    }

    try {
      const ok = await deliver({
        to,
        subject: row.subject,
        body: row.body,
        link: row.link,
        actionRequired: row.action_required,
      });
      if (ok) {
        await markSent(row.id);
        sent += 1;
      } else {
        await markFailed(row.id, "channel reported delivery failure");
        failed += 1;
      }
    } catch (e) {
      // A throwing channel is still just a delivery failure here.
      await markFailed(row.id, e instanceof Error ? e.message : "channel threw");
      failed += 1;
    }
  }

  return { considered: rows.length, sent, failed, undeliverable };
}

/** `notification.dispatch` job handler. */
export function dispatchHandler(deps: DispatchDeps): JobHandler {
  return async () => {
    const r = await dispatchDue(deps);
    return { kind: "DONE", note: `${String(r.sent)} sent, ${String(r.failed)} failed, ${String(r.undeliverable)} undeliverable` };
  };
}

/** Plain-text rendering shared by both channels. */
export function renderText(row: Pick<NotificationRow, "subject" | "body" | "link" | "action_required">): string {
  const lines = [row.subject, "", row.body];
  if (row.link) lines.push("", row.link);
  if (row.action_required) lines.push("", "This one needs you to take a look.");
  return lines.join("\n");
}
