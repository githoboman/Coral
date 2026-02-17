// server/src/routes/auth.ts
//
// REGISTRATION vs POINTS — two separate concerns:
//
//   check-user:             Walrus registry lookup → on-chain fallback for legacy users
//   claim-waitlist-points:  On-chain events (source of truth for "has this wallet claimed points")
//
// Onboarding check priority:
//   1. Walrus profile exists → onboarded (all users going forward)
//   2. On-chain PointsClaimed event exists → onboarded (legacy users pre-Walrus)
//   3. Neither → new user, show onboarding modal
//
// On-chain is touched for:
//   /check-user             — fallback only, for wallets not in Walrus registry
//   /claim-waitlist-points  — double-claim prevention + actual point minting

import { Router, Request, Response, NextFunction } from "express";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { WaitlistManager } from "../services/waitlistManager";
import {
  WalrusUserManager,
  getWalrusUserManager,
} from "../services/walrusUserManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";

const router = Router();

const WHITELIST_BLOB_ID = process.env.WHITELIST_BLOB_ID || "";

// ─── Sui client ───────────────────────────────────────────────────────────────
const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const suiClient = new SuiClient({ url: getFullnodeUrl(network) });
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";

let waitlistManager: WaitlistManager | null = null;
let userManager: WalrusUserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getWaitlistManager(): WaitlistManager {
  if (!waitlistManager) waitlistManager = new WaitlistManager();
  return waitlistManager;
}
function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = getWalrusUserManager();
  return userManager;
}
function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

// ─── normalizeAddr ────────────────────────────────────────────────────────────
function normalizeAddr(addr: string): string {
  return (
    "0x" + (addr.startsWith("0x") ? addr.slice(2) : addr).padStart(64, "0")
  );
}

// ─── hasClaimedOnChain ────────────────────────────────────────────────────────
// Used in TWO places:
//   1. /claim-waitlist-points — prevent double-claiming
//   2. /check-user fallback   — recognise legacy users not yet in Walrus
async function hasClaimedOnChain(walletAddress: string): Promise<boolean> {
  if (!PACKAGE_ID) return false;

  const normalized = normalizeAddr(walletAddress);

  // ── Primary: MoveEventField filter (targeted query for this wallet) ─────────
  try {
    const result = await suiClient.queryEvents({
      query: {
        MoveEventField: {
          path: "/wallet_address",
          value: normalized,
        },
      } as any,
      limit: 1,
      order: "descending",
    });

    if (result.data.length > 0) {
      const ev = result.data[0];
      const eventType: string = (ev as any).type || "";
      if (eventType.startsWith(PACKAGE_ID)) {
        return true;
      }
    }
  } catch {
    // MoveEventField not supported — fall through to scan
  }

  // ── Fallback: scan PointsClaimed events ─────────────────────────────────────
  try {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
      limit: 50,
      order: "descending",
    });

    for (const ev of page.data) {
      const data = ev.parsedJson as any;
      if (
        data?.wallet_address &&
        normalizeAddr(data.wallet_address) === normalized
      ) {
        return true;
      }
    }

    if (page.hasNextPage && page.nextCursor) {
      let cursor: string | undefined = page.nextCursor;
      let hasNext = true;
      while (hasNext && cursor) {
        const next = await suiClient.queryEvents({
          query: { MoveEventType: `${PACKAGE_ID}::points::PointsClaimed` },
          cursor,
          limit: 50,
          order: "descending",
        });
        for (const ev of next.data) {
          const data = ev.parsedJson as any;
          if (
            data?.wallet_address &&
            normalizeAddr(data.wallet_address) === normalized
          ) {
            return true;
          }
        }
        hasNext = next.hasNextPage;
        cursor = next.nextCursor ?? undefined;
      }
    }

    return false;
  } catch (rpcErr) {
    console.warn(
      "[CLAIM-CHECK] queryEvents failed, using devInspect fallback:",
      rpcErr,
    );
    try {
      const minter = getLocalTicketMinter();
      return await minter.hasClaimed(walletAddress);
    } catch {
      return false;
    }
  }
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        email,
        wallet_address,
        username,
        first_name,
        last_name,
        preferences,
      } = req.body;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }
      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const minter = getLocalTicketMinter();
      const um = getUserManager();

      const blobRegistry = await minter.getCurrentBlobId();

      if (blobRegistry) {
        const existingWallet = await um.findWalletByEmail(
          blobRegistry,
          normalizedEmail,
        );
        if (existingWallet && existingWallet !== wallet_address) {
          res.status(409).json({
            error: "Conflict",
            detail:
              "This email address is already registered to another wallet.",
          });
          return;
        }
      }

      const profile = um.createUserProfile(
        normalizedEmail,
        wallet_address,
        false,
        0,
        {
          username: username || undefined,
          first_name: first_name || undefined,
          last_name: last_name || undefined,
          preferences: preferences || {},
        },
      );

      const newBlobId = await um.addOrUpdateUser(blobRegistry || null, profile);

      if (!newBlobId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to save user profile to Walrus",
        });
        return;
      }

      if (newBlobId !== blobRegistry) {
        await minter.updateBlobRegistry(newBlobId);
      }

      res.json({
        success: true,
        user: {
          email: normalizedEmail,
          wallet_address,
          username: username || null,
        },
        message: "Profile saved successfully.",
      });
    } catch (error) {
      console.error("Error in register:", error);
      next(error);
    }
  },
);

// ─── POST /api/auth/claim-waitlist-points ────────────────────────────────────
router.post(
  "/claim-waitlist-points",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, wallet_address } = req.body;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }
      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }
      if (!WHITELIST_BLOB_ID) {
        res.status(500).json({
          error: "Configuration Error",
          detail: "Waitlist not configured",
        });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const minter = getLocalTicketMinter();

      // On-chain: already claimed? (correct use of hasClaimedOnChain — points, not registration)
      const alreadyClaimed = await hasClaimedOnChain(wallet_address);
      if (alreadyClaimed) {
        res.json({
          success: false,
          already_claimed: true,
          message: "Points already claimed.",
        });
        return;
      }

      // Walrus: email on whitelist?
      const isWhitelisted = await getWaitlistManager().isEmailWhitelisted(
        normalizedEmail,
        WHITELIST_BLOB_ID,
      );
      if (!isWhitelisted) {
        res.status(403).json({
          success: false,
          eligible: false,
          message: "Email is not on the waitlist.",
        });
        return;
      }

      const claimResult =
        await minter.sponsoredClaimWaitlistPoints(wallet_address);

      if (!claimResult.success) {
        res.status(500).json({
          success: false,
          error: "Claim Failed",
          detail: claimResult.error || "Failed to claim points",
        });
        return;
      }

      // Update Walrus profile async — non-blocking
      (async () => {
        try {
          const um = getUserManager();
          const blobRegistry = await minter.getCurrentBlobId();
          if (blobRegistry) {
            const existing = await um.getUserProfile(
              blobRegistry,
              wallet_address,
            );
            if (existing) {
              const updated = um.createUserProfile(
                existing.email,
                existing.wallet_address,
                true,
                existing.points_awarded,
                {
                  username: existing.username,
                  first_name: existing.first_name,
                  last_name: existing.last_name,
                  preferences: existing.preferences,
                  waitlist_verified_at: new Date().toISOString(),
                },
              );
              const newBlobId = await um.addOrUpdateUser(blobRegistry, updated);
              if (newBlobId && newBlobId !== blobRegistry) {
                await minter.updateBlobRegistry(newBlobId);
              }
            }
          }
        } catch (err) {
          console.warn(
            "[CLAIM] Walrus profile update failed (non-fatal):",
            err,
          );
        }
      })();

      res.json({
        success: true,
        claimed: true,
        transaction_digest: claimResult.digest,
        points_awarded: 100,
        new_balance: claimResult.balance || 100,
        message: "🎉 Waitlist points awarded!",
      });
    } catch (error) {
      console.error("Error in claim-waitlist-points:", error);
      next(error);
    }
  },
);

// ─── GET /api/auth/check-user ─────────────────────────────────────────────────
//
// Hybrid registration check:
//
//   Step 1 — Walrus profile lookup (primary, covers all new registrations)
//   Step 2 — On-chain PointsClaimed fallback (covers ~188 legacy users who
//             have blockchain activity but no Walrus profile yet)
//
// This prevents the onboarding modal from appearing for users who:
//   a) Registered normally and have a Walrus profile ✓
//   b) Registered before Walrus was set up / had a Walrus write failure ✓
//   c) Are genuinely new and have never interacted with the platform ✗ (show modal)
//
router.get(
  "/check-user",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      console.log(
        `[CHECK-USER] ${wallet_address.slice(0, 10)}... checking Walrus registry`,
      );

      // ── Step 1: Walrus profile lookup ────────────────────────────────────────
      let profile = null;
      let walrusFailed = false;

      try {
        const minter = getLocalTicketMinter();
        const um = getUserManager();
        const blobId =
          um.getCachedBlobId() ?? (await minter.getCurrentBlobId());

        if (blobId) {
          profile = await um.getUserProfile(blobId, wallet_address);
        }
      } catch (walrusErr) {
        console.warn(
          "[CHECK-USER] Walrus lookup failed — will try on-chain fallback:",
          walrusErr,
        );
        walrusFailed = true;
      }

      if (profile) {
        const isOnboarded = !!profile.email;
        console.log(
          `[CHECK-USER] ${wallet_address.slice(0, 10)}... found in Walrus registry → onboarded ✓`,
        );
        res.json({ exists: true, is_onboarded: isOnboarded, user: profile });
        return;
      }

      // ── Step 2: On-chain fallback for legacy users ───────────────────────────
      // Users who registered before Walrus was set up have PointsClaimed events
      // but no Walrus profile. We check on-chain to recognise them so they don't
      // see the onboarding modal every time they reload.
      //
      // We skip this only if Walrus itself errored AND we're not sure whether
      // they have a profile (walrusFailed). In that case we still check on-chain
      // as a best-effort.
      console.log(
        `[CHECK-USER] ${wallet_address.slice(0, 10)}... not in Walrus, checking on-chain (legacy fallback)`,
      );

      try {
        const onChain = await hasClaimedOnChain(wallet_address);
        if (onChain) {
          console.log(
            `[CHECK-USER] ${wallet_address.slice(0, 10)}... found on-chain → legacy user, onboarded ✓`,
          );
          // Return onboarded but with no profile data — client will still work,
          // the user just won't have a stored email/username until they update their profile.
          res.json({
            exists: true,
            is_onboarded: true,
            user: null,
            legacy: true,
          });
          return;
        }
      } catch (chainErr) {
        console.warn("[CHECK-USER] On-chain fallback also failed:", chainErr);
        // If both Walrus AND on-chain failed, treat as new user conservatively.
        // Better to show the modal than to silently break.
      }

      console.log(
        `[CHECK-USER] ${wallet_address.slice(0, 10)}... not found anywhere → new user`,
      );
      res.json({ exists: false, is_onboarded: false, user: null });
    } catch (error) {
      console.error("Error in check-user:", error);
      next(error);
    }
  },
);

// ─── GET /api/auth/check-waitlist ─────────────────────────────────────────────
router.get(
  "/check-waitlist",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.query;

      if (!email || typeof email !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Email is required" });
        return;
      }
      if (!WHITELIST_BLOB_ID) {
        res.json({ on_waitlist: false });
        return;
      }

      const isWaitlisted = await getWaitlistManager().isEmailWhitelisted(
        email.toLowerCase().trim(),
        WHITELIST_BLOB_ID,
      );
      res.json({ on_waitlist: isWaitlisted });
    } catch (error) {
      console.error("Error in check-waitlist:", error);
      next(error);
    }
  },
);

// ─── GET /api/auth/check-claim-status ────────────────────────────────────────
router.get(
  "/check-claim-status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address, tx_digest } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "Wallet address is required" });
        return;
      }

      const minter = getLocalTicketMinter();

      if (tx_digest && typeof tx_digest === "string") {
        const verification = await minter.verifyClaimByDigest(tx_digest);
        if (verification?.confirmed) {
          res.json({
            claimed: true,
            balance: verification.balance,
            wallet_address,
          });
          return;
        }
      }

      const claimed = await hasClaimedOnChain(wallet_address);
      const balance = await minter.getBalance(wallet_address);
      res.json({ claimed, balance, wallet_address });
    } catch (error) {
      console.error("Error in check-claim-status:", error);
      next(error);
    }
  },
);

export default router;
