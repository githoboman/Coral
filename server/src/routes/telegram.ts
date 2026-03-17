import express from "express";
import { getTelegramService } from "../services/telegramService";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = express.Router();
const telegramService = getTelegramService();

// POST /api/telegram/connect - Generate a Telegram link code for the authenticated user
router.post("/connect", requireAuth, async (req: AuthRequest, res) => {
  try {
    // Always use the authenticated wallet address, ignore any provided walletAddress in body
    const walletAddress = req.user!.wallet_address;

    const code = await telegramService.generateCode(walletAddress);
    const botUsername = telegramService.getBotUsername();

    res.json({ code, botUsername });
  } catch (error) {
    console.error("Error generating telegram code:", error);
    res.status(500).json({ error: "Failed to generate connection code" });
  }
});

// POST /api/telegram/unlink - Unlink Telegram for the authenticated user only
router.post("/unlink", requireAuth, async (req: AuthRequest, res) => {
  try {
    // Always use the authenticated wallet address, ignore any provided walletAddress in body
    const walletAddress = req.user!.wallet_address;

    await telegramService.unlinkAccount(walletAddress);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error unlinking telegram account:", error);
    res.status(500).json({ error: "Failed to unlink account" });
  }
});

// GET /api/telegram/status - Check Telegram link status for the authenticated user
router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    // Always use the authenticated wallet address
    const walletAddress = req.user!.wallet_address;

    const account = await telegramService.getStatus(walletAddress);
    res.json({
      is_linked: !!account,
      telegram_username: account?.telegram_username
    });
  } catch (error) {
    console.error("Error getting telegram status:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

export default router;
