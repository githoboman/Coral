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
      const updatedProfile = userManager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        profile.points_awarded,
        {
          ...profile,
          telegram_chat_id: undefined,
          telegram_username: undefined,
        }
      );

      const newBlobId = await userManager.addOrUpdateUser(blobId, updatedProfile);
      if (newBlobId && newBlobId !== blobId) {
        await ticketMinter.updateBlobRegistry(newBlobId);
      }
      return res.json({ success: true });
    }

    res.status(404).json({ error: "User not found" });
  } catch (error) {
    next(error);
  }
});

export default router;