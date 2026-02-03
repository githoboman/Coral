import { Router, Request, Response, NextFunction } from "express";
import { WaitlistManager } from "../services/waitlistManager";

const router = Router();

const WHITELIST_BLOB_ID = process.env.WHITELIST_BLOB_ID || "";

let waitlistManager: WaitlistManager | null = null;

function getWaitlistManager(): WaitlistManager {
  if (!waitlistManager) waitlistManager = new WaitlistManager();
  return waitlistManager;
}

router.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "Email is required",
        });
        return;
      }

      if (!WHITELIST_BLOB_ID) {
        res.status(500).json({
          error: "Configuration Error",
          detail: "Waitlist not configured",
        });
        return;
      }

      const manager = getWaitlistManager();
      const isWhitelisted = await manager.isEmailWhitelisted(
        email,
        WHITELIST_BLOB_ID,
      );

      if (isWhitelisted) {
        res.json({
          whitelisted: true,
          message: "Email is on the waitlist",
          email: email.toLowerCase().trim(),
        });
      } else {
        res.status(403).json({
          whitelisted: false,
          message: "Email is not on the waitlist",
        });
      }
    } catch (error) {
      console.error("Error verifying waitlist:", error);
      next(error);
    }
  },
);

router.get(
  "/info",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!WHITELIST_BLOB_ID) {
        res.status(500).json({
          error: "Configuration Error",
          detail: "Waitlist not configured",
        });
        return;
      }

      const manager = getWaitlistManager();
      const whitelist = await manager.fetchWhitelist(WHITELIST_BLOB_ID);

      if (!whitelist) {
        res.status(500).json({
          error: "Error",
          detail: "Could not fetch whitelist",
        });
        return;
      }

      res.json({
        version: whitelist.version,
        total_count: whitelist.total_count,
        created_at: whitelist.created_at,
        description: whitelist.description,
        blob_id: WHITELIST_BLOB_ID,
      });
    } catch (error) {
      console.error("Error fetching waitlist info:", error);
      next(error);
    }
  },
);

export default router;
