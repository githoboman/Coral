// server/src/routes/bridgeTransactions.ts
// Stores and retrieves bridge transaction history per user.
// Table: bridge_transactions (create with migration below)
//
// SQL to run in Supabase:
// ─────────────────────────────────────────────────────────────
// create table bridge_transactions (
//   id            bigserial primary key,
//   user_id       text not null,
//   direction     text not null,           -- 'SUI_TO_SOL' | 'SOL_TO_SUI' | etc.
//   source_chain  text not null,
//   dest_chain    text not null,
//   amount_in     text not null,           -- human display e.g. "0.5000 SUI"
//   amount_out    text not null,           -- human display e.g. "0.00529 SOL"
//   source_tx     text not null,           -- tx hash / digest on source chain
//   dest_tx       text,                    -- filled once delivery confirmed
//   status        text not null default 'submitted',  -- submitted | delivered | failed
//   created_at    timestamptz not null default now(),
//   updated_at    timestamptz not null default now()
// );
// create index on bridge_transactions(user_id, created_at desc);
// ─────────────────────────────────────────────────────────────

import { Router, Response } from "express";
import { getSupabaseClient } from "../config/supabase";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// ── POST /api/bridge/transactions ─────────────────────────────────────
// Called by the frontend immediately after the user signs and the
// source-chain tx hash is known.

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

// ── PATCH /api/bridge/transactions/:id ────────────────────────────────
// Called by the frontend once delivery is confirmed (dest_tx known).

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
        .eq("user_id", userId); // security: only owner can update

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

// ── GET /api/bridge/transactions ──────────────────────────────────────
// Fetch all bridge transactions for the authenticated user.

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
