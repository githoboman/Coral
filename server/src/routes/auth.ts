import { Router, Request, Response, NextFunction } from "express";
import { WaitlistManager } from "../services/waitlistManager";
import { WalrusUserManager, getWalrusUserManager } from "../services/walrusUserManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";

const router = Router();

const WHITELIST_BLOB_ID = process.env.WHITELIST_BLOB_ID || "";

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
      const minter = getTicketMinter();
      const um = getUserManager();

      console.log(`📝 Saving profile for: ${normalizedEmail} (encrypted)`);
      const blobRegistry = await minter.getCurrentBlobId();

      console.log(`Current BlobRegistry from chain: ${blobRegistry || "null"}`);

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
        console.log(
          `📦 Updating BlobRegistry on-chain: ${blobRegistry} -> ${newBlobId}`,
        );
        await minter.updateBlobRegistry(newBlobId);
        console.log(`✅ BlobRegistry updated on-chain → ${newBlobId}`);
      }

      console.log(`✅ Encrypted profile saved for ${wallet_address}`);

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

// UPDATED: Now handles the full sponsored claim flow
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

      console.log(
        `\n🔍 [SPONSORED CLAIM] Checking eligibility for: ${wallet_address}`,
      );

      // Step 1: Check if already claimed
      const alreadyClaimed = await minter.hasClaimed(wallet_address);
      if (alreadyClaimed) {
        res.json({
          success: false,
          already_claimed: true,
          message: "Points already claimed for this wallet.",
        });
        return;
      }

      // Step 2: Verify waitlist eligibility
      console.log(`🔍 Checking waitlist for: ${normalizedEmail}`);
      const isWhitelisted = await getWaitlistManager().isEmailWhitelisted(
        normalizedEmail,
        WHITELIST_BLOB_ID,
      );

      if (!isWhitelisted) {
        res.status(403).json({
          success: false,
          eligible: false,
          message:
            "Email is not on the waitlist. New users do not receive points.",
        });
        return;
      }

      // Step 3: Execute sponsored claim (backend mints ticket & claims in one transaction)
      console.log(`💰 Executing sponsored claim...`);
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

      console.log(`✅ Points successfully claimed! tx=${claimResult.digest}`);

      // Step 4: Update user profile asynchronously (non-blocking)
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
              const updatedProfile = um.createUserProfile(
                existingProfile.email,
                existingProfile.wallet_address,
                true, // is_waitlisted = true
                existingProfile.points_awarded,
                {
                  username: existingProfile.username,
                  first_name: existingProfile.first_name,
                  last_name: existingProfile.last_name,
                  preferences: existingProfile.preferences,
                  waitlist_verified_at: new Date().toISOString(),
                },
              );

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
      })();

      // Step 5: Return success to user
      res.json({
        success: true,
        claimed: true,
        transaction_digest: claimResult.digest,
        points_awarded: 100,
        new_balance: claimResult.balance || 100,
        message:
          "🎉 Congratulations! Your waitlist points have been awarded. No gas fees required!",
      });
    } catch (error) {
      console.error("Error in claim-waitlist-points:", error);
      next(error);
    }
  },
);

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

      const minter = getLocalTicketMinter();
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

        console.warn(
          "⚠️  Digest did not contain PointsClaimed event, falling through to normal read",
        );
      }

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
