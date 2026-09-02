/**
 * Session mirror + the off-chain half of the kill switch (FR-8.2, SEC-14).
 *
 * A session becomes ACTIVE only after post-install read-back verification
 * (CLAUDE.md §2.2). Revocation flips `signer_disabled` the instant the user
 * asks — before any on-chain confirmation — which is what makes the off-chain
 * disable <1s (NFR-3) rather than a block time.
 */
import { query } from "../db/pool.js";

export type SessionStatus =
  | "PENDING_INSTALL"
  | "ACTIVE"
  | "PAUSED_MISMATCH"
  | "PAUSED_DRIFT"
  | "PAUSED_MODULE_CHANGE"
  | "REVOKED"
  | "EXPIRED"
  | "INSTALL_FAILED";

export interface SessionRow {
  readonly id: string;
  readonly chain_id: number;
  readonly account: string;
  readonly owner: string;
  readonly agent_signer: string;
  readonly permission_id: string;
  readonly policy: Record<string, unknown>;
  readonly status: SessionStatus;
  readonly signer_disabled: boolean;
  readonly valid_after: string;
  readonly valid_until: string;
  readonly install_tx: string | null;
  readonly revoke_tx: string | null;
}

export interface CreateSessionInput {
  readonly chainId: number;
  readonly account: string;
  readonly owner: string;
  readonly agentSigner: string;
  readonly permissionId: string;
  readonly policy: Record<string, unknown>;
  readonly validAfter: number;
  readonly validUntil: number;
}

export async function createSession(i: CreateSessionInput): Promise<SessionRow> {
  const rows = await query<SessionRow>(
    `INSERT INTO corral_sessions (chain_id, account, owner, agent_signer, permission_id, policy, valid_after, valid_until)
     VALUES ($1, lower($2), lower($3), lower($4), lower($5), $6::jsonb, $7, $8)
     ON CONFLICT (chain_id, account, permission_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [i.chainId, i.account, i.owner, i.agentSigner, i.permissionId, JSON.stringify(i.policy), i.validAfter, i.validUntil],
  );
  const row = rows[0];
  if (!row) throw new Error("failed to create session row");
  return row;
}

export async function getSession(id: string): Promise<SessionRow | null> {
  return (await query<SessionRow>(`SELECT * FROM corral_sessions WHERE id = $1`, [id]))[0] ?? null;
}

export async function getByPermissionId(chainId: number, account: string, permissionId: string): Promise<SessionRow | null> {
  return (
    (await query<SessionRow>(`SELECT * FROM corral_sessions WHERE chain_id = $1 AND account = lower($2) AND permission_id = lower($3)`, [chainId, account, permissionId]))[0] ?? null
  );
}

/** Only a zero-mismatch verification may call this (CLAUDE.md §2.2). */
export async function markActive(id: string, installTx: string): Promise<void> {
  await query(`UPDATE corral_sessions SET status = 'ACTIVE', install_tx = $2, verified_at = now(), updated_at = now() WHERE id = $1`, [id, installTx]);
}

export async function setStatus(id: string, status: SessionStatus): Promise<void> {
  await query(`UPDATE corral_sessions SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}

/**
 * FR-8.2: disable the off-chain signer immediately, without waiting for the
 * revoke transaction. Idempotent; returns the row so callers can report the
 * exact moment it took effect.
 */
export async function disableSigner(id: string): Promise<SessionRow | null> {
  return (
    (await query<SessionRow>(
      `UPDATE corral_sessions
          SET signer_disabled = true,
              signer_disabled_at = coalesce(signer_disabled_at, now()),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id],
    ))[0] ?? null
  );
}

export async function markRevoked(id: string, revokeTx: string | null): Promise<void> {
  await query(`UPDATE corral_sessions SET status = 'REVOKED', revoke_tx = $2, signer_disabled = true, updated_at = now() WHERE id = $1`, [id, revokeTx]);
}

export async function listActive(): Promise<SessionRow[]> {
  return query<SessionRow>(`SELECT * FROM corral_sessions WHERE status = 'ACTIVE' AND NOT signer_disabled ORDER BY created_at`);
}

export type ExecutableCheck = { ok: true } | { ok: false; reason: string };

/**
 * The off-chain gate. Independent of any caller (SEC-14): the signer asks
 * this before every signature, and the relayer asks it before every
 * submission, so a compromised planner cannot talk either into acting on a
 * revoked or expired session.
 */
export function isExecutable(session: SessionRow, nowSeconds: number = Math.floor(Date.now() / 1000)): ExecutableCheck {
  if (session.signer_disabled) return { ok: false, reason: "signer disabled (revoke requested)" };
  if (session.status !== "ACTIVE") return { ok: false, reason: `session status is ${session.status}` };
  if (nowSeconds < Number(session.valid_after)) return { ok: false, reason: "session is not yet valid" };
  if (nowSeconds >= Number(session.valid_until)) return { ok: false, reason: "session has expired" };
  return { ok: true };
}
