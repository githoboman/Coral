import express from "express";
import { getTelegramService } from "../services/telegramService";

const router = express.Router();
const telegramService = getTelegramService();

router.post("/connect", async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: "Missing walletAddress" });
    }

    const code = await telegramService.generateCode(walletAddress);
    const botUsername = telegramService.getBotUsername();

    res.json({ code, botUsername });
  } catch (error) {
    console.error("Error generating telegram code:", error);
    res.status(500).json({ error: "Failed to generate connection code" });
  }
});

router.post("/unlink", async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: "Missing walletAddress" });
    }

    await telegramService.unlinkAccount(walletAddress);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error unlinking telegram account:", error);
    res.status(500).json({ error: "Failed to unlink account" });
  }
});

router.get("/status", async (req, res) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid walletAddress" });
    }

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
