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

router.post("/claim/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const walletAddress = req.user!.wallet_address;
    const referralId = req.params.id;
    
    if (!referralId) {
      res.status(400).json({ error: "Referral ID is required" });
      return;
    }

    const result = await referralService.claimReferral(walletAddress, referralId);
    
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    
    res.json(result);
  } catch (err) {
    console.error("Error claiming referral:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
