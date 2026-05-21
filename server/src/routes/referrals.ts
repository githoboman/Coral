import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getReferralService } from "../services/referralService";

const router = Router();
const referralService = getReferralService();

router.get("/stats", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const walletAddress = req.user!.wallet_address;
    const stats = await referralService.getReferralStats(walletAddress);
    
    if (!stats) {
      res.status(404).json({ error: "Stats not found" });
      return;
    }
    
    res.json(stats);
  } catch (err) {
    console.error("Error fetching referral stats:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
