// src/routes/auth.ts  —  FIXED VERSION (v2)
//
// What changed vs the previous "FIXED VERSION":
//
//   check-claim-status now accepts an optional ?tx_digest= query param.
//   When the frontend has just received a successful digest it can pass it
//   here for instant, event-based confirmation — no devInspect, no latency.
//
//   When no digest is supplied (legacy polling path) it falls through to
//   the rewritten hasClaimed / getBalance in TicketMinter which now check
//   on-chain events FIRST and only fall back to devInspect when there are
//   genuinely no events (i.e. the wallet has never claimed).

import { Router, Request, Response, NextFunction } from "express";
import { WaitlistManager } from "../services/waitlistManager";
import { WalrusUserManager, UserProfile } from "../services/walrusUserManager";
import { TicketMinter } from "../services/ticketMinter";

const router = Router();

// Blob ID for WAITLIST (this is separate from user registry!)
const WHITELIST_BLOB_ID = process.env.WHITELIST_BLOB_ID || "";

// -----------------------------------------------------------------------
// Singleton managers
// -----------------------------------------------------------------------
let waitlistManager: WaitlistManager | null = null;
let userManager: WalrusUserManager | null = null;
let ticketMinter: TicketMinter | null = null;

function getWaitlistManager(): WaitlistManager {
  if (!waitlistManager) waitlistManager = new WaitlistManager();
  return waitlistManager;
}
function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = new WalrusUserManager();
  return userManager;
}
function getTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = new TicketMinter();
  return ticketMinter;
}

// =======================================================================
// POST /api/auth/register
// =======================================================================
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

      // --- validation ---
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
      const minter = getTicketMinter();
      const um = getUserManager();

      // --- 1. Get current blob registry ID from chain ---
      console.log(`📝 Saving profile for: ${normalizedEmail}`);
      const blobRegistry = await minter.getCurrentBlobId();

      console.log(`Current BlobRegistry from chain: ${blobRegistry || "null"}`);

      // --- 1b. Duplicate-email guard ---
      //   An email can only ever be tied to one wallet.  If the registry
      //   already exists and this email is already taken by a *different*
      //   wallet, reject immediately.  Same wallet → fine (idempotent update).
      if (blobRegistry) {
        const existingWallet = await um.findWalletByEmail(
          blobRegistry,
          normalizedEmail,
        );

        if (existingWallet && existingWallet !== wallet_address) {
          console.warn(
            `⛔ Duplicate email: "${normalizedEmail}" already registered to ${existingWallet}`,
          );
          res.status(409).json({
            error: "Conflict",
            detail:
              "This email address is already registered to another wallet.",
          });
          return;
        }
      }

      // --- 2. Create user profile ---
      const profile: UserProfile = {
        email: normalizedEmail,
        wallet_address,
        username: username || undefined,
        first_name: first_name || undefined,
        last_name: last_name || undefined,
        preferences: preferences || {},
        is_waitlisted: false,
        points_awarded: 0,
        joined_at: new Date().toISOString(),
      };

      // --- 3. Save to Walrus ---
      const newBlobId = await um.addOrUpdateUser(blobRegistry || null, profile);

      if (!newBlobId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to save user profile to Walrus",
        });
        return;
      }

      // --- 4. Update on-chain BlobRegistry if blob ID changed ---
      if (newBlobId !== blobRegistry) {
        console.log(
          `📦 Updating BlobRegistry on-chain: ${blobRegistry} -> ${newBlobId}`,
        );
        await minter.updateBlobRegistry(newBlobId);
        console.log(`✅ BlobRegistry updated on-chain → ${newBlobId}`);
      }

      console.log(`✅ Profile saved for ${wallet_address}`);

      // --- 5. Return success ---
      res.json({
        success: true,
        user: {
          email: normalizedEmail,
          wallet_address,
          username: username || null,
        },
        message:
          "Profile saved successfully. You can now check if you're eligible for points.",
      });
    } catch (error) {
      console.error("Error in register:", error);
      next(error);
    }
  },
);

// =======================================================================
// POST /api/auth/verify-and-issue-ticket
// =======================================================================
router.post(
  "/verify-and-issue-ticket",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, wallet_address } = req.body;

      // --- validation ---
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
      const minter = getTicketMinter();

      // --- 1. Check on-chain: has this wallet already claimed? ---
      console.log(`\n🔍 Checking on-chain claim status for: ${wallet_address}`);
      const alreadyClaimed = await minter.hasClaimed(wallet_address);

      if (alreadyClaimed) {
        res.json({
          eligible: false,
          already_claimed: true,
          message: "Points already claimed for this wallet.",
        });
        return;
      }

      // --- 2. Check waitlist on Walrus ---
      console.log(`🔍 Checking waitlist for: ${normalizedEmail}`);
      const isWaitlisted = await getWaitlistManager().isEmailWhitelisted(
        normalizedEmail,
        WHITELIST_BLOB_ID,
      );

      if (!isWaitlisted) {
        res.status(403).json({
          eligible: false,
          already_claimed: false,
          message:
            "Email is not on the waitlist. New users do not receive points.",
        });
        return;
      }

      // --- 3. Mint EligibilityTicket on-chain ---
      console.log(`🎟️  Minting EligibilityTicket for ${wallet_address}...`);
      const ticketObjectId = await minter.mintTicket(
        wallet_address,
        300,
        "Waitlist Bonus",
      );

      if (!ticketObjectId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to mint eligibility ticket. Please try again.",
        });
        return;
      }

      console.log(`✅ Ticket minted: ${ticketObjectId}`);

      // --- 4. Update user profile in Walrus to mark as waitlisted ---
      //   Non-critical, fire in background — don't hold up the ticket response.
      (async () => {
        try {
          const um = getUserManager();
          const blobRegistry = await minter.getCurrentBlobId();

          if (blobRegistry) {
            const existingProfile = await um.getUserProfile(
              blobRegistry,
              wallet_address,
            );

            if (existingProfile) {
              const updatedProfile = {
                ...existingProfile,
                is_waitlisted: true,
                waitlist_verified_at: new Date().toISOString(),
              };

              const newBlobId = await um.addOrUpdateUser(
                blobRegistry,
                updatedProfile,
              );

              if (newBlobId && newBlobId !== blobRegistry) {
                await minter.updateBlobRegistry(newBlobId);
                console.log(`📦 BlobRegistry updated on-chain → ${newBlobId}`);
              }
            }
          }
        } catch (walrusErr) {
          console.warn(
            "⚠️  Walrus profile update failed (non-fatal):",
            walrusErr,
          );
        }
      })(); // ← invoked immediately, not awaited

      // --- 5. Return ticket ID to frontend ---
      res.json({
        eligible: true,
        already_claimed: false,
        ticket_object_id: ticketObjectId,
        points_amount: 300,
        message: "Eligible! Sign the claim transaction to receive your points.",
      });
    } catch (error) {
      console.error("Error in verify-and-issue-ticket:", error);
      next(error);
    }
  },
);

// =======================================================================
// GET /api/auth/check-user
// =======================================================================
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

      const minter = getTicketMinter();
      const blobId = await minter.getCurrentBlobId();

      console.log(`check-user: blobId from chain = ${blobId || "null"}`);

      if (!blobId) {
        console.log("No BlobRegistry yet - user needs to register first");
        res.json({ exists: false, user: null });
        return;
      }

      const um = getUserManager();
      const userProfile = await um.getUserProfile(blobId, wallet_address);

      res.json({
        exists: !!userProfile,
        user: userProfile || null,
      });
    } catch (error) {
      console.error("Error in check-user:", error);
      next(error);
    }
  },
);
// =======================================================================
// GET /api/auth/check-waitlist
//
// Pure read — no ticket minting, no side effects.
// Used after registration to decide whether to show the claim screen.
//
// Query params:
//   email   (required)
//
// Response:
//   { on_waitlist: boolean }
// =======================================================================
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
        // No waitlist configured at all — no one is waitlisted.
        res.json({ on_waitlist: false });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const isWaitlisted = await getWaitlistManager().isEmailWhitelisted(
        normalizedEmail,
        WHITELIST_BLOB_ID,
      );

      res.json({ on_waitlist: isWaitlisted });
    } catch (error) {
      console.error("Error in check-waitlist:", error);
      next(error);
    }
  },
);
// =======================================================================
// GET /api/auth/check-claim-status
//
// Query params:
//   wallet_address   (required)  – the wallet to check
//   tx_digest        (optional)  – if the caller just signed a claim tx,
//                                  pass its digest here for instant
//                                  event-based confirmation.
//
// Response shape (unchanged, so frontend needs zero changes):
//   { claimed: boolean, balance: number, wallet_address: string }
// =======================================================================
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

      const minter = getTicketMinter();

      // ------------------------------------------------------------------
      // FAST PATH: caller supplied a tx digest  →  verify directly from
      // the transaction receipt.  Zero latency, 100 % reliable.
      // ------------------------------------------------------------------
      if (tx_digest && typeof tx_digest === "string") {
        console.log(
          `\n⚡ check-claim-status: fast path via digest ${tx_digest}`,
        );

        const verification = await minter.verifyClaimByDigest(tx_digest);

        if (verification?.confirmed) {
          res.json({
            claimed: true,
            balance: verification.balance,
            wallet_address,
          });
          return;
        }

        // Digest didn't contain the expected event — fall through to the
        // normal read path rather than returning a hard failure.  This can
        // happen if the digest belongs to a different tx.
        console.warn(
          "⚠️  Digest did not contain PointsClaimed event, falling through to normal read",
        );
      }

      // ------------------------------------------------------------------
      // NORMAL PATH: event scan + devInspect fallback (inside TicketMinter)
      // ------------------------------------------------------------------
      const claimed = await minter.hasClaimed(wallet_address);
      const balance = await minter.getBalance(wallet_address);

      res.json({
        claimed,
        balance,
        wallet_address,
      });
    } catch (error) {
      console.error("Error in check-claim-status:", error);
      next(error);
    }
  },
);

export default router;
