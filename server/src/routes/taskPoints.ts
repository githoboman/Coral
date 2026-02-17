import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { WalrusUserManager, getWalrusUserManager } from "../services/walrusUserManager";

const router = Router();

let ticketMinter: TicketMinter | null = null;
let userManager: WalrusUserManager | null = null;

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

function getUserManager(): WalrusUserManager {
  if (!userManager) userManager = getWalrusUserManager();
  return userManager;
}

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

router.get(
  "/claimable",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.query;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "user_id is required",
        });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format",
        });
        return;
      }

      const minter = getLocalTicketMinter();
      const manager = getUserManager();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      if (!userRegistryBlobId) {
        res.json({
          tasks_created_today: 0,
          tasks_claimed_today: 0,
          claimable_tasks: 0,
          points_per_task: 2,
          total_claimable_points: 0,
        });
        return;
      }

      const profile = await manager.getUserProfile(userRegistryBlobId, user_id);

      if (!profile) {
        res.json({
          tasks_created_today: 0,
          tasks_claimed_today: 0,
          claimable_tasks: 0,
          points_per_task: 2,
          total_claimable_points: 0,
        });
        return;
      }

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      const tasksCreated = needsReset ? 0 : profile.tasks_created_today || 0;
      const tasksClaimed = needsReset ? 0 : profile.tasks_claimed_today || 0;
      const claimable = Math.max(0, tasksCreated - tasksClaimed);

      console.log(`[TASK POINTS] User ${user_id.substring(0, 10)}...`);
      console.log(
        `  Created: ${tasksCreated}, Claimed: ${tasksClaimed}, Claimable: ${claimable}`,
      );

      res.json({
        tasks_created_today: tasksCreated,
        tasks_claimed_today: tasksClaimed,
        claimable_tasks: claimable,
        points_per_task: 2,
        total_claimable_points: claimable * 2,
        last_reset_date: profile.last_task_reset_date || today,
      });
    } catch (error) {
      console.error("Error getting claimable tasks:", error);
      next(error);
    }
  },
);

router.post(
  "/request-claim",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, task_count } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "user_id is required",
        });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format",
        });
        return;
      }

      if (!task_count || task_count <= 0) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid task_count",
        });
        return;
      }

      const minter = getLocalTicketMinter();
      const manager = getUserManager();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      if (!userRegistryBlobId) {
        res.status(404).json({
          error: "Not Found",
          detail: "User registry not found",
        });
        return;
      }

      const profile = await manager.getUserProfile(userRegistryBlobId, user_id);
      if (!profile) {
        res.status(404).json({
          error: "Not Found",
          detail: "User profile not found",
        });
        return;
      }

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      const tasksCreated = needsReset ? 0 : profile.tasks_created_today || 0;
      const tasksClaimed = needsReset ? 0 : profile.tasks_claimed_today || 0;
      const claimable = Math.max(0, tasksCreated - tasksClaimed);

      if (task_count > claimable) {
        res.status(400).json({
          error: "Bad Request",
          detail: `Cannot claim ${task_count} tasks. Only ${claimable} tasks are claimable.`,
        });
        return;
      }

      console.log(
        `🎟️  Minting task claim ticket for ${user_id}: ${task_count} tasks`,
      );

      const ticketObjectId = await minter.mintTaskClaimTicket(
        user_id,
        task_count,
      );

      if (!ticketObjectId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to mint task claim ticket. Please try again.",
        });
        return;
      }

      console.log(`✅ Task claim ticket minted: ${ticketObjectId}`);

      res.json({
        success: true,
        ticket_object_id: ticketObjectId,
        task_count,
        points_amount: task_count * 2,
        message: `Claim ${task_count * 2} points for ${task_count} task${task_count > 1 ? "s" : ""}!`,
      });
    } catch (error) {
      console.error("Error requesting task claim:", error);
      next(error);
    }
  },
);

router.post(
  "/track-creation",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "user_id is required",
        });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format",
        });
        return;
      }

      const minter = getLocalTicketMinter();
      const manager = getUserManager();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      if (!userRegistryBlobId) {
        res.status(404).json({
          error: "Not Found",
          detail: "User registry not found",
        });
        return;
      }

      const profile = await manager.getUserProfile(userRegistryBlobId, user_id);
      if (!profile) {
        res.status(404).json({
          error: "Not Found",
          detail: "User profile not found",
        });
        return;
      }

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      const currentCreated = needsReset ? 0 : profile.tasks_created_today || 0;
      const currentClaimed = needsReset ? 0 : profile.tasks_claimed_today || 0;
      const newCreated = currentCreated + 1;

      const updatedProfile = manager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        profile.points_awarded,
        {
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          preferences: profile.preferences,
          waitlist_verified_at: profile.waitlist_verified_at,
          chat_registry_blob_id: profile.chat_registry_blob_id,
          tasks_created_today: newCreated,
          tasks_claimed_today: currentClaimed,
          last_task_reset_date: today,
          subscription_tier: profile.subscription_tier,
          subscription_expires_at: profile.subscription_expires_at,
          daily_prompts_used: profile.daily_prompts_used,
          last_prompt_date: profile.last_prompt_date,
          telegram_chat_id: profile.telegram_chat_id,
          telegram_username: profile.telegram_username,
          telegram_linked_at: profile.telegram_linked_at,
        },
      );

      const newBlobId = await manager.addOrUpdateUser(
        userRegistryBlobId,
        updatedProfile,
      );

      if (!newBlobId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to update task count",
        });
        return;
      }

      if (newBlobId !== userRegistryBlobId) {
        await minter.updateBlobRegistry(newBlobId);
      }

      console.log(
        `[TASK POINTS] Tracked creation for ${user_id}: ${newCreated} tasks`,
      );

      res.json({
        success: true,
        tasks_created_today: newCreated,
        message: "Task creation tracked successfully",
      });
    } catch (error) {
      console.error("Error tracking task creation:", error);
      next(error);
    }
  },
);

router.post(
  "/confirm-claim",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, task_count } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "user_id is required",
        });
        return;
      }

      if (!task_count || task_count <= 0) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid task_count",
        });
        return;
      }

      const minter = getLocalTicketMinter();
      const manager = getUserManager();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      if (!userRegistryBlobId) {
        res.status(404).json({
          error: "Not Found",
          detail: "User registry not found",
        });
        return;
      }

      const profile = await manager.getUserProfile(userRegistryBlobId, user_id);
      if (!profile) {
        res.status(404).json({
          error: "Not Found",
          detail: "User profile not found",
        });
        return;
      }

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      const currentClaimed = needsReset ? 0 : profile.tasks_claimed_today || 0;
      const newClaimed = currentClaimed + task_count;

      const onChainBalance = await minter.getBalance(user_id);

      console.log(`[TASK POINTS] On-chain balance: ${onChainBalance}`);
      console.log(
        `[TASK POINTS] Walrus cached balance: ${profile.points_awarded}`,
      );

      const updatedProfile = manager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        onChainBalance,
        {
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          preferences: profile.preferences,
          waitlist_verified_at: profile.waitlist_verified_at,
          chat_registry_blob_id: profile.chat_registry_blob_id,
          task_registry_blob_id: profile.task_registry_blob_id,
          tasks_created_today: profile.tasks_created_today || 0,
          tasks_claimed_today: newClaimed,
          last_task_reset_date: today,
          subscription_tier: profile.subscription_tier,
          subscription_expires_at: profile.subscription_expires_at,
          daily_prompts_used: profile.daily_prompts_used,
          last_prompt_date: profile.last_prompt_date,
          telegram_chat_id: profile.telegram_chat_id,
          telegram_username: profile.telegram_username,
          telegram_linked_at: profile.telegram_linked_at,
        },
      );

      const newBlobId = await manager.addOrUpdateUser(
        userRegistryBlobId,
        updatedProfile,
      );

      if (!newBlobId) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to confirm claim",
        });
        return;
      }

      if (newBlobId !== userRegistryBlobId) {
        await minter.updateBlobRegistry(newBlobId);
      }

      console.log(
        `[TASK POINTS] Confirmed claim for ${user_id}: ${newClaimed} tasks claimed, ${onChainBalance} points total`,
      );

      res.json({
        success: true,
        tasks_claimed_today: newClaimed,
        total_points: onChainBalance,
        message: "Claim confirmed successfully",
      });
    } catch (error) {
      console.error("Error confirming claim:", error);
      next(error);
    }
  },
);

router.get(
  "/stats/:user_id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.params;

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res.status(400).json({
          error: "Bad Request",
          detail: "Invalid wallet address format",
        });
        return;
      }

      const minter = getLocalTicketMinter();
      const manager = getUserManager();

      const userRegistryBlobId = await minter.getCurrentBlobId();
      if (!userRegistryBlobId) {
        res.json({
          tasks_created_today: 0,
          tasks_claimed_today: 0,
          total_tasks_created: 0,
          total_points_earned: 0,
          last_claim_date: null,
        });
        return;
      }

      const profile = await manager.getUserProfile(userRegistryBlobId, user_id);
      if (!profile) {
        res.json({
          tasks_created_today: 0,
          tasks_claimed_today: 0,
          total_tasks_created: 0,
          total_points_earned: 0,
          last_claim_date: null,
        });
        return;
      }

      const balance = await minter.getBalance(user_id);

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      res.json({
        tasks_created_today: needsReset ? 0 : profile.tasks_created_today || 0,
        tasks_claimed_today: needsReset ? 0 : profile.tasks_claimed_today || 0,
        total_points_earned: balance,
        last_task_reset_date: profile.last_task_reset_date,
      });
    } catch (error) {
      console.error("Error getting task stats:", error);
      next(error);
    }
  },
);

export default router;
