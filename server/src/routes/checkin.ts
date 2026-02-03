import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter } from "../services/ticketMinter";

const router = Router();

let ticketMinter: TicketMinter | null = null;

function getTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = new TicketMinter();
  return ticketMinter;
}

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address } = req.query;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "wallet_address is required",
        });
        return;
      }

      const minter = getTicketMinter();

      const lastCheckinMs = await minter.getLastCheckin(wallet_address);
      const balance = await minter.getBalance(wallet_address);

      const now = Date.now();
      const COOLDOWN_MS = 24 * 60 * 60 * 1000;

      let canCheckin = true;
      let nextAvailableMs: number | null = null;
      let hoursRemaining: number | null = null;

      if (lastCheckinMs > 0) {
        const timeSinceLastMs = now - lastCheckinMs;
        canCheckin = timeSinceLastMs >= COOLDOWN_MS;

        if (!canCheckin) {
          const timeRemainingMs = COOLDOWN_MS - timeSinceLastMs;
          hoursRemaining = Math.ceil(timeRemainingMs / (1000 * 60 * 60));
          nextAvailableMs = lastCheckinMs + COOLDOWN_MS;
        }
      }

      res.json({
        can_checkin: canCheckin,
        last_checkin_at: lastCheckinMs > 0 ? lastCheckinMs : null,
        next_available_at: nextAvailableMs,
        hours_remaining: hoursRemaining,
        balance,
      });
    } catch (error) {
      console.error("Error in checkin/status:", error);
      next(error);
    }
  },
);

router.post(
  "/request-ticket",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { wallet_address } = req.body;

      if (!wallet_address || typeof wallet_address !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "wallet_address is required",
        });
        return;
      }

      const minter = getTicketMinter();

      const lastCheckinMs = await minter.getLastCheckin(wallet_address);
      const now = Date.now();
      const COOLDOWN_MS = 24 * 60 * 60 * 1000;

      if (lastCheckinMs > 0) {
        const timeSinceLastMs = now - lastCheckinMs;

        if (timeSinceLastMs < COOLDOWN_MS) {
          const timeRemainingMs = COOLDOWN_MS - timeSinceLastMs;
          const hoursRemaining = Math.ceil(timeRemainingMs / (1000 * 60 * 60));

          res.json({
            success: false,
            can_checkin: false,
            hours_remaining: hoursRemaining,
            message: `You can check in again in ${hoursRemaining} hour${hoursRemaining !== 1 ? "s" : ""}.`,
          });
          return;
        }
      }

      console.log(`🎟️  Minting check-in ticket for ${wallet_address}...`);

      const ticketObjectId = await minter.mintTicket(
        wallet_address,
        2,
        "Daily Check-in",
      );

      if (!ticketObjectId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to mint check-in ticket. Please try again.",
        });
        return;
      }

      console.log(`✅ Check-in ticket minted: ${ticketObjectId}`);

      res.json({
        success: true,
        ticket_object_id: ticketObjectId,
        points_amount: 2,
        message:
          "Check-in ticket ready! Sign the transaction to claim your 2 points.",
      });
    } catch (error) {
      console.error("Error in checkin/request-ticket:", error);
      next(error);
    }
  },
);

export default router;
