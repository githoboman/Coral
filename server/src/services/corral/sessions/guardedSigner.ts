/**
 * SEC-14: the signer independently refuses to sign for a revoked, paused or
 * expired session — regardless of who is asking.
 *
 * This is the layer that replaces a custody vendor's policy engine. It is
 * defence in depth, not the guarantee: the on-chain policies are. But it is
 * what makes revocation effective in under a second, before any block.
 *
 * Every request is recorded (outcome included), so a compromised planner
 * hammering the signer is visible rather than silent.
 */
import type { Hex } from "viem";

import type { SessionSigner } from "../../evm/execute/sessionSigner.js";
import { query } from "../db/pool.js";
import { getSession, isExecutable } from "./repository.js";

export class SignerRefused extends Error {
  constructor(readonly reason: string) {
    super(`signer refused: ${reason}`);
    this.name = "SignerRefused";
  }
}

async function audit(sessionId: string, hash: string, outcome: string, requester: string): Promise<void> {
  // Best-effort: an audit write must never block or fail a refusal.
  await query(
    `INSERT INTO corral_signer_audit (session_id, op_hash, requester, outcome) VALUES ($1, $2, $3, $4)`,
    [sessionId, hash, requester, outcome],
  ).catch(() => undefined);
}

/**
 * Wrap a raw signer so it can only produce signatures for a session that is
 * ACTIVE, in-window, and not disabled — checked against the database at the
 * moment of signing, not at construction.
 */
export function guardedSessionSigner(inner: SessionSigner, sessionId: string, requester = "pipeline"): SessionSigner {
  return {
    address: inner.address,
    async signHash(hash: Hex): Promise<Hex> {
      const session = await getSession(sessionId);
      if (!session) {
        await audit(sessionId, hash, "REFUSED_UNKNOWN_SESSION", requester);
        throw new SignerRefused("unknown session");
      }
      const check = isExecutable(session);
      if (!check.ok) {
        await audit(sessionId, hash, session.signer_disabled ? "REFUSED_REVOKED" : "REFUSED_INELIGIBLE", requester);
        throw new SignerRefused(check.reason);
      }
      if (session.agent_signer.toLowerCase() !== inner.address.toLowerCase()) {
        await audit(sessionId, hash, "REFUSED_WRONG_SIGNER", requester);
        throw new SignerRefused("signer address does not match the session's agent signer");
      }
      const sig = await inner.signHash(hash);
      await audit(sessionId, hash, "SIGNED", requester);
      return sig;
    },
  };
}
