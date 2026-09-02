/**
 * `module.monitor` (C-506, FR-1.5) — detect a change to an account's installed
 * module set and pause the session.
 *
 * FR-1.5 is an allowlist requirement: only modules in the approved manifest
 * may be installed, and anything else is detected and alerted within a block.
 * The reason this matters more than it sounds: a session's policies are only
 * as binding as the validator enforcing them. Install a second validator with
 * looser rules and the SmartSessions policies are simply bypassed — the funds
 * never needed to leave through our path at all.
 *
 * Only the owner can install a module, so a change here is either the owner
 * doing something deliberate or a compromised owner key. Neither is a case
 * where continuing to execute is correct, so both pause.
 *
 * Enumeration honesty: `getValidatorsPaginated` is a Safe7579 extension, not
 * something every ERC-7579 account offers. When it is unavailable we fall back
 * to positive checks — expected modules still installed — and say so in the
 * snapshot rather than reporting a clean bill of health we did not verify.
 */
import type { Address, PublicClient } from "viem";

import type { ChainAddresses } from "../../evm/addresses.js";
import { query } from "../db/pool.js";
import { recordAnomaly } from "../reconcile/budget.js";
import type { SessionRow } from "../sessions/repository.js";

/** ERC-7579 module type ids. */
const MODULE_TYPE_VALIDATOR = 1n;

const erc7579Abi = [
  {
    type: "function",
    name: "isModuleInstalled",
    stateMutability: "view",
    inputs: [
      { name: "moduleTypeId", type: "uint256" },
      { name: "module", type: "address" },
      { name: "additionalContext", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getValidatorsPaginated",
    stateMutability: "view",
    inputs: [
      { name: "cursor", type: "address" },
      { name: "pageSize", type: "uint256" },
    ],
    outputs: [
      { name: "array", type: "address[]" },
      { name: "next", type: "address" },
    ],
  },
] as const;

/** Sentinel used by Safe-style linked lists. */
const SENTINEL: Address = "0x0000000000000000000000000000000000000001";

export interface ModuleSnapshot {
  readonly account: Address;
  /** Validators the account reports, when enumeration is available. */
  readonly validators: Address[];
  /** Pinned modules we require to be present. */
  readonly expected: Address[];
  /** Installed validators outside the manifest — the dangerous set. */
  readonly unexpected: Address[];
  /** Manifest modules that are no longer installed. */
  readonly missing: Address[];
  /**
   * False when the account does not support validator enumeration. The
   * snapshot is then a positive check only: it can prove a required module is
   * gone, but not that nothing extra was added.
   */
  readonly enumerated: boolean;
}

function lower(a: string): string {
  return a.toLowerCase();
}

/** Modules this account is permitted to have installed as validators. */
export function expectedValidators(addresses: ChainAddresses): Address[] {
  return [addresses.smartSessions.address, addresses.ownableValidator.address];
}

export async function snapshotModules(
  client: PublicClient,
  addresses: ChainAddresses,
  account: Address,
): Promise<ModuleSnapshot> {
  const expected = expectedValidators(addresses);

  let validators: Address[] = [];
  let enumerated = true;
  try {
    let cursor: Address = SENTINEL;
    for (let page = 0; page < 10; page++) {
      const [array, next] = await client.readContract({
        address: account,
        abi: erc7579Abi,
        functionName: "getValidatorsPaginated",
        args: [cursor, 50n],
      });
      validators.push(...array);
      if (next === SENTINEL || next === "0x0000000000000000000000000000000000000000" || array.length === 0) break;
      cursor = next;
    }
  } catch {
    enumerated = false;
    validators = [];
  }

  const expectedSet = new Set(expected.map(lower));
  const unexpected = enumerated ? validators.filter((v) => !expectedSet.has(lower(v))) : [];

  // Missing is checked positively either way — this is the half of the
  // question we can always answer.
  const missing: Address[] = [];
  for (const module of expected) {
    try {
      const installed = await client.readContract({
        address: account,
        abi: erc7579Abi,
        functionName: "isModuleInstalled",
        args: [MODULE_TYPE_VALIDATOR, module, "0x"],
      });
      if (!installed) missing.push(module);
    } catch {
      // A reverting getter is itself a change worth flagging: the account no
      // longer answers the ERC-7579 interface we installed against.
      missing.push(module);
    }
  }

  return { account, validators, expected, unexpected, missing, enumerated };
}

export interface MonitorResult {
  readonly sessionId: string;
  readonly changed: boolean;
  readonly paused: boolean;
  readonly snapshot: ModuleSnapshot;
}

/**
 * Check one session's account and pause it on any change.
 *
 * Pausing is deliberately one-way here: a session leaves `PAUSED_MODULE_CHANGE`
 * only by a human deciding the change was intended (spec §11.4). Auto-resuming
 * on "the module went away again" would be trivially gameable.
 */
export async function monitorSession(
  client: PublicClient,
  addresses: ChainAddresses,
  session: SessionRow,
): Promise<MonitorResult> {
  const snapshot = await snapshotModules(client, addresses, session.account as Address);
  const changed = snapshot.unexpected.length > 0 || snapshot.missing.length > 0;

  if (!changed) return { sessionId: session.id, changed: false, paused: false, snapshot };

  await recordAnomaly(session.id, "MODULE_SET_CHANGED", {
    account: session.account,
    unexpected: snapshot.unexpected,
    missing: snapshot.missing,
    enumerated: snapshot.enumerated,
  });

  // Pause only from ACTIVE: a session already paused or revoked keeps the
  // state it has, so the first cause of a pause stays visible.
  const rows = await query<{ id: string }>(
    `UPDATE corral_sessions SET status = 'PAUSED_MODULE_CHANGE', updated_at = now()
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING id`,
    [session.id],
  );
  return { sessionId: session.id, changed: true, paused: rows.length > 0, snapshot };
}

/** Sweep every active session. Intended to run once per block-ish interval. */
export async function monitorActiveSessions(
  client: PublicClient,
  addresses: ChainAddresses,
  limit = 100,
): Promise<MonitorResult[]> {
  const sessions = await query<SessionRow>(
    `SELECT * FROM corral_sessions WHERE status = 'ACTIVE' AND chain_id = $1 ORDER BY updated_at LIMIT $2`,
    [addresses.chainId, limit],
  );
  const out: MonitorResult[] = [];
  for (const s of sessions) {
    out.push(await monitorSession(client, addresses, s));
  }
  return out;
}
