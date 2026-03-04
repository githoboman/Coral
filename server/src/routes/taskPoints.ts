import { Router, Request, Response, NextFunction } from "express";
import { UserManager, getUserManager as getUserManagerService } from "../services/userManager";
import { getLeaderboardService } from "../services/leaderboardService";
import getSupabaseClient from "../config/supabase";

const router = Router();
const supabase = getSupabaseClient();

let userManager: UserManager | null = null;

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
        points_per_research: 3,
        total_claimable_points: (claimableTasks * 2) + (claimableResearch * 3),
        last_reset_date: profile.last_task_reset_date || today,
      });
    } catch (error) {
      console.error("Error getting claimable tasks:", error);
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
      const { user_id } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res.status(400).json({
          error: "Bad Request",
          detail: "user_id is required",
        });
        return;
      }

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

      if (totalClaimable <= 0) {
        res.status(400).json({
          error: "Bad Request",
          detail: "No activities available to claim",
        });
        return;
      }

      const pointsToCredit = (claimableTasks * 2) + (claimableResearch * 3);

      const newTasksClaimed = tasksClaimed + claimableTasks;
      const newResClaimed = researchClaimed + claimableResearch;

      console.log(`[TASK POINTS] Gasless claim for ${user_id}: ${pointsToCredit} points`);

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({
          tasks_claimed_today: newTasksClaimed,
          research_claimed_today: newResClaimed,
          last_task_reset_date: today
        })
        .eq('wallet_address', user_id);

      if (updateError) throw updateError;

      // Instantly credit points to leaderboard
      await getLeaderboardService().creditPoints(user_id, pointsToCredit);

      res.json({
        success: true,
        tasks_claimed_today: newTasksClaimed,
        research_claimed_today: newResClaimed,
        total_activities_claimed: totalClaimable,
        points_awarded: pointsToCredit,
        message: `Successfully claimed ${pointsToCredit} points!`,
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
