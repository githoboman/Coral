import { Router, Request, Response, NextFunction } from "express";
import { TicketMinter, getTicketMinter } from "../services/ticketMinter";
import { UserManager, getUserManager as getUserManagerService } from "../services/userManager";
import { getLeaderboardService } from "../services/leaderboardService";

const router = Router();

let ticketMinter: TicketMinter | null = null;
let userManager: UserManager | null = null;

function getLocalTicketMinter(): TicketMinter {
  if (!ticketMinter) ticketMinter = getTicketMinter();
  return ticketMinter;
}

function getLocalUserManager(): UserManager {
  if (!userManager) userManager = getUserManagerService();
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

      const manager = getLocalUserManager();
      const profile = await manager.getUserProfile(user_id);

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
      const researchCreated = needsReset ? 0 : profile.research_created_today || 0;
      const researchClaimed = needsReset ? 0 : profile.research_claimed_today || 0;

      const claimableTasks = Math.max(0, tasksCreated - tasksClaimed);
      const claimableResearch = Math.max(0, researchCreated - researchClaimed);
      const totalClaimable = claimableTasks + claimableResearch;

      console.log(`[TASK POINTS] User ${user_id.substring(0, 10)}...`);
      console.log(
        `  Tasks: ${tasksCreated}/${tasksClaimed} (${claimableTasks}), Research: ${researchCreated}/${researchClaimed} (${claimableResearch})`,
      );

      res.json({
        tasks_created_today: tasksCreated,
        tasks_claimed_today: tasksClaimed,
        research_created_today: researchCreated,
        research_claimed_today: researchClaimed,
        claimable_tasks: claimableTasks,
        claimable_research: claimableResearch,
        total_activities: totalClaimable,
        points_per_task: 2,
        total_claimable_points: totalClaimable * 2,
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
      const manager = getLocalUserManager();

      const profile = await manager.getUserProfile(user_id);
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
      const researchCreated = needsReset ? 0 : profile.research_created_today || 0;
      const researchClaimed = needsReset ? 0 : profile.research_claimed_today || 0;

      const claimableTasks = Math.max(0, tasksCreated - tasksClaimed);
      const claimableResearch = Math.max(0, researchCreated - researchClaimed);
      const totalClaimable = claimableTasks + claimableResearch;

      if (task_count > totalClaimable) {
        res.status(400).json({
          error: "Bad Request",
          detail: `Cannot claim ${task_count} activities. Only ${totalClaimable} are claimable.`,
        });
        return;
      }

      console.log(
        `Minting task claim ticket for ${user_id}: ${task_count} tasks`,
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

      console.log(`Task claim ticket minted: ${ticketObjectId}`);

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
      const { user_id, type } = req.body;
      const activityType = (type === "research" || type === "activity") ? "research" : "task";

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

      const manager = getLocalUserManager();

      const today = getTodayDate();
      const success = await manager.incrementActivityCount(user_id, activityType, today);

      if (!success) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to track activity creation",
        });
        return;
      }

      res.json({
        success: true,
        type: activityType,
        message: `${activityType} tracked successfully`,
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
      const manager = getLocalUserManager();

      const profile = await manager.getUserProfile(user_id);
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
      const researchCreated = needsReset ? 0 : profile.research_created_today || 0;
      const researchClaimed = needsReset ? 0 : profile.research_claimed_today || 0;

      const claimableTasks = Math.max(0, tasksCreated - tasksClaimed);
      const claimableResearch = Math.max(0, researchCreated - researchClaimed);

      // Distribute claim_count between tasks and research
      let remainingToClaim = task_count;
      let tasksToClaim = Math.min(remainingToClaim, claimableTasks);
      remainingToClaim -= tasksToClaim;
      let resToClaim = Math.min(remainingToClaim, claimableResearch);

      const newTasksClaimed = tasksClaimed + tasksToClaim;
      const newResClaimed = researchClaimed + resToClaim;

      console.log(`[TASK POINTS] Credit claim: ${task_count * 2} points`);

      const updatedProfile = manager.createUserProfile(
        profile.email,
        profile.wallet_address,
        profile.is_waitlisted,
        profile.points_awarded || 0,
        {
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          preferences: profile.preferences,
          waitlist_verified_at: profile.waitlist_verified_at,
          tasks_created_today: tasksCreated,
          tasks_claimed_today: newTasksClaimed,
          research_created_today: researchCreated,
          research_claimed_today: newResClaimed,
          last_task_reset_date: today,
          subscription_tier: profile.subscription_tier,
          subscription_expires_at: profile.subscription_expires_at,
          daily_prompts_used: profile.daily_prompts_used,
          last_prompt_date: profile.last_prompt_date,
        },
      );

      const result = await manager.addOrUpdateUser(updatedProfile);

      if (!result) {
        res.status(500).json({
          error: "Internal Server Error",
          detail: "Failed to confirm claim",
        });
        return;
      }

      console.log(
        `[TASK POINTS] Confirmed claim for ${user_id}: ${newTasksClaimed} tasks and ${newResClaimed} research claimed`,
      );

      // Instantly credit points to leaderboard (handles both points and xp columns)
      await getLeaderboardService().creditPoints(user_id, task_count * 2);

      res.json({
        success: true,
        tasks_claimed_today: newTasksClaimed,
        research_claimed_today: newResClaimed,
        total_activities_claimed: newTasksClaimed + newResClaimed,
        total_points: (profile.points_awarded || 0) + (task_count * 2),
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
      const manager = getLocalUserManager();

      const profile = await manager.getUserProfile(user_id);
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

      const today = getTodayDate();
      const needsReset =
        !profile.last_task_reset_date || profile.last_task_reset_date !== today;

      res.json({
        tasks_created_today: needsReset ? 0 : profile.tasks_created_today || 0,
        tasks_claimed_today: needsReset ? 0 : profile.tasks_claimed_today || 0,
        total_points_earned: profile.points_awarded || 0,
        last_task_reset_date: profile.last_task_reset_date,
      });
    } catch (error) {
      console.error("Error getting task stats:", error);
      next(error);
    }
  },
);

export default router;
