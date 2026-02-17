import { Router, Request, Response, NextFunction } from "express";
import { getTelegramService } from "../services/telegramService";
import { getWalrusUserManager } from "../services/walrusUserManager";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";

const router = Router();
const userManager = getWalrusUserManager();
const ticketMinter = getTicketMinter();

/**
 * Initiates the linking process by generating a token.
 */
router.post("/link", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ error: "wallet_address is required" });
    }

    const telegramService = getTelegramService();
    // Use wallet address directly as the token/payload
    const deepLink = telegramService.getDeepLink(wallet_address);

    res.json({ token: wallet_address, deep_link: deepLink });
  } catch (error) {
    next(error);
  }
});

/**
 * Gets the current Telegram connection status for a wallet.
 */
router.get("/status/:wallet_address", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { wallet_address } = req.params;
    const blobId = await ticketMinter.getCurrentBlobId();

    if (!blobId) {
      // Registry not found usually means system not init, but for frontend consistency return not linked
      return res.json({ is_linked: false });
    }

    const profile = await userManager.getUserProfile(blobId, wallet_address);
    if (!profile) {
      // User not registered yet, so definitely not linked
      return res.json({ is_linked: false });
    }

    res.json({
      is_linked: !!profile.telegram_chat_id,
      telegram_chat_id: profile.telegram_chat_id,
      telegram_username: profile.telegram_username,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Optional: Disconnects Telegram.
 */
router.post("/disconnect", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { wallet_address } = req.body;
    const blobId = await ticketMinter.getCurrentBlobId();

    if (!blobId || !wallet_address) {
      return res.status(400).json({ error: "Bad Request" });
    }

    const profile = await userManager.getUserProfile(blobId, wallet_address);
    if (profile) {
      // Create cleaner profile without telegram fields
      const {
        telegram_chat_id,
        telegram_username,
        telegram_linked_at,
        ...rest
      } = profile;

      const updatedProfile = userManager.createUserProfile(
        rest.email,
        rest.wallet_address,
        rest.is_waitlisted,
        rest.points_awarded,
        {
          ...rest,
          // Explicitly omit these fields just in case
          telegram_chat_id: undefined,
          telegram_username: undefined,
          telegram_linked_at: undefined,
        }
      );

      const newBlobId = await userManager.addOrUpdateUser(blobId, updatedProfile);

      if (newBlobId && newBlobId !== blobId) {
        // Wait for registry update on chain
        const txDigest = await ticketMinter.updateBlobRegistry(newBlobId);

        if (!txDigest) {
          console.error("Failed to update blob registry on chain");
          // Even if chain update fails, we might have updated local cache? 
          // But consistency is key.
          return res.status(500).json({ error: "Failed to persist disconnection on-chain" });
        }
      }
      return res.json({ success: true });
    }

    res.status(404).json({ error: "User not found" });
  } catch (error) {
    next(error);
  }
});

export default router;