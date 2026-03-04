import { Router, Request, Response } from "express";
import { priceService } from "../services/priceService";

const router = Router();

// GET /api/price/:coinType?
router.get("/:coinType?", async (req: Request, res: Response) => {
  try {
    const coinType = req.params.coinType || '0x2::sui::SUI';
    console.log(`[PriceAPI] Fetching price for: ${coinType}`);
    const priceData = await priceService.getTokenPrice(coinType);
    console.log(`[PriceAPI] Result:`, priceData);

    // If no price found, we might still return 200 with 0, or 404. 
    // priceService returns { price: 0, change24h: 0 } on failure, so we just return that.
    res.json({
      coinType,
      price: priceData.price,
      change24h: priceData.change24h,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("Error fetching price:", error);
    res.status(500).json({ error: "Failed to fetch price" });
  }
});

export default router;
