import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getBlockVisionService } from "../services/blockVisionService";

const router = Router();
const bvService = getBlockVisionService();

/**
 * GET /api/wallet/balance
 * Returns the authenticated user's current SUI/token portfolio.
 */
router.get("/wallet/balance", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const address = req.user!.wallet_address;
    const portfolio = await bvService.getAccountPortfolio(address);

    return res.json({
      status: true,
      message: "Balance fetched successfully",
      data: [
        {
          wallet_address: address,
          coins: portfolio.coins.map(c => ({
            symbol: c.symbol,
            name: c.name,
            balance: c.balance,
            price_usd: c.price,
            value_usd: c.valueUsd,
          })),
          total_value_usd: portfolio.totalValue,
        }
      ]
    });
  } catch (error: any) {
    console.error(`[WALLET] Error fetching balance for ${req.user?.wallet_address}:`, error);
    return res.status(500).json({ 
      status: false,
      message: "Internal Server Error",
      data: [],
      errors: [
        {
          code: "INTERNAL_SERVER_ERROR",
          detail: error.message
        }
      ]
    });
  }
});

/**
 * POST /api/wallet/charge
 * Validates available balance and returns a payment intent for on-chain execution.
 */
router.post("/wallet/charge", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { coin_type, amount, reason } = req.body;
    const address = req.user!.wallet_address;
    const TREASURY_ADDRESS = process.env.CORAL_TREASURY_ADDRESS;

    if (!TREASURY_ADDRESS) {
      console.error("[WALLET] CORAL_TREASURY_ADDRESS is not configured in environment.");
      return res.status(500).json({ 
        status: false,
        message: "Server configuration error",
        data: [],
        errors: [{ code: "CONFIG_ERROR", detail: "Treasury address not set" }]
      });
    }

    if (!coin_type || !amount) {
      return res.status(400).json({ 
        status: false,
        message: "Bad Request",
        data: [],
        errors: [{ code: "MISSING_PARAMS", detail: "coin_type and amount are required" }]
      });
    }

    const portfolio = await bvService.getAccountPortfolio(address);
    const coin = portfolio.coins.find(c => c.coinType === coin_type);

    if (!coin) {
      return res.status(400).json({
        status: false,
        message: "Coin not found in wallet",
        data: [],
        errors: [
          {
            code: "COIN_NOT_FOUND",
            coin_type
          }
        ]
      });
    }

    const currentBalance = parseFloat(coin.balance);
    const chargeAmount = parseFloat(amount);

    if (currentBalance < chargeAmount) {
      return res.status(402).json({
        status: false,
        message: "Insufficient balance",
        data: [],
        errors: [
          {
            code: "INSUFFICIENT_BALANCE",
            required: amount,
            available: coin.balance,
            coin_type
          }
        ]
      });
    }

    // Convert decimal amount to Mist/Base units (amount * 10^decimals)
    const amountMist = (BigInt(Math.floor(chargeAmount * Math.pow(10, coin.decimals)))).toString();

    return res.json({
      status: true,
      message: "Payment intent created",
      data: [
        {
          payment_intent: {
            recipient: TREASURY_ADDRESS,
            coin_type,
            amount_mist: amountMist,
            reason: reason || "Coral Charge",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }
        }
      ]
    });
  } catch (error: any) {
    console.error(`[WALLET] Error processing charge for ${req.user?.wallet_address}:`, error);
    return res.status(500).json({ 
      status: false,
      message: "Internal Server Error",
      data: [],
      errors: [
        {
          code: "INTERNAL_SERVER_ERROR",
          detail: error.message
        }
      ]
    });
  }
});

export default router;
