import { Router, Response } from "express";
import { getSupabaseClient } from "../config/supabase";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

router.post(
  "/transactions",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.wallet_address;
      const {
        direction,
        source_chain,
        dest_chain,
        amount_in,
        amount_out,
        source_tx,
      } = req.body;

      if (
        !direction ||
        !source_chain ||
        !dest_chain ||
        !amount_in ||
        !amount_out ||
        !source_tx
      ) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("bridge_transactions")
        .insert({
          user_id: userId,
          direction,
          source_chain,
          dest_chain,
          amount_in,
          amount_out,
          source_tx,
          status: "submitted",
        })
        .select()
        .single();

      if (error) {
        console.error("[BRIDGE TX] Insert error:", error);
        return res.status(500).json({ error: "Failed to save transaction" });
      }

      return res.status(201).json(data);
    } catch (err) {
      console.error("[BRIDGE TX] POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.patch(
  "/transactions/:id",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.wallet_address;
      const id = parseInt(req.params.id, 10);
      const { status, dest_tx } = req.body;

      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("bridge_transactions")
        .update({
          status: status || "delivered",
          dest_tx: dest_tx || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", userId);

      if (error) {
        console.error("[BRIDGE TX] Update error:", error);
        return res.status(500).json({ error: "Failed to update transaction" });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error("[BRIDGE TX] PATCH error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get(
  "/transactions",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.wallet_address;
      const limit = Math.min(
        parseInt((req.query.limit as string) || "50", 10),
        100,
      );

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("bridge_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("[BRIDGE TX] Fetch error:", error);
        return res.status(500).json({ error: "Failed to fetch transactions" });
      }

      return res.json(data || []);
    } catch (err) {
      console.error("[BRIDGE TX] GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
