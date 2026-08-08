import { Router, Request, Response, NextFunction } from "express";
import getSupabaseClient from "../config/supabase";

const router = Router();
const supabase = getSupabaseClient();

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

      const normalizedEmail = email.toLowerCase().trim();

      const { data, error } = await supabase
        .from('waitlist_emails')
        .select('id')
        .ilike('email', normalizedEmail)
        .maybeSingle();

      if (error) {
        console.error("Error checking waitlist:", error);
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Could not check waitlist",
        });
        return;
      }

      if (data) {
        res.json({
          whitelisted: true,
          message: "Email is on the waitlist",
          email: normalizedEmail,
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
      const { count, error } = await supabase
        .from('waitlist_emails')
        .select('*', { count: 'exact', head: true });

      if (error) {
        res.status(500).json({
          error: "Error",
          detail: "Could not fetch waitlist info",
        });
        return;
      }

      res.json({
        total_count: count || 0,
        storage: "Supabase",
        description: "Waitlist emails stored in Supabase",
      });
    } catch (error) {
      console.error("Error fetching waitlist info:", error);
      next(error);
    }
  },
);

export default router;
