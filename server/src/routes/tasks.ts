import { Router, Request, Response, NextFunction } from "express";
import { getTaskStorageService } from "../services/taskStorageService";
import { getNotificationService } from "../services/notificationService";

const router = Router();

// Create task
router.post(
  "/tasks",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        user_id,
        task_name,
        description,
        due_date,
        priority,
        tags,
        action_type,
        action_params,
      } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      if (!task_name || typeof task_name !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "task_name is required" });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res
          .status(400)
          .json({
            error: "Bad Request",
            detail: "Invalid wallet address format",
          });
        return;
      }

      const taskStorage = getTaskStorageService();

      const result = await taskStorage.createTask(user_id, {
        task_name,
        description: description || undefined,
        due_date: due_date || undefined,
        priority: priority || "medium",
        tags: tags || [],
        status: "pending",
        action_type: action_type || undefined,
        action_params: action_params || undefined,
        action_status: action_type ? "pending" : undefined,
      });

      if (!result) {
        res
          .status(500)
          .json({
            error: "Internal Server Error",
            detail: "Failed to create task",
          });
        return;
      }

      const task = await taskStorage.getTask(user_id, result.taskId);

      // Send Telegram notification
      const notificationService = getNotificationService();
      if (task) {
        notificationService.sendTaskCreatedNotification(user_id, task).catch(err => 
          console.error("Failed to send task creation notification:", err)
        );
      }

      res.json({
        success: true,
        task,
        message: "Task created successfully in Walrus storage",
      });
    } catch (error) {
      console.error("Error creating task:", error);
      next(error);
    }
  },
);

// Bulk create tasks
router.post(
  "/tasks/bulk",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, tasks } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      if (!Array.isArray(tasks) || tasks.length === 0) {
        res
          .status(400)
          .json({
            error: "Bad Request",
            detail: "tasks array is required and must not be empty",
          });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res
          .status(400)
          .json({
            error: "Bad Request",
            detail: "Invalid wallet address format",
          });
        return;
      }

      const taskStorage = getTaskStorageService();
      const createdTasks = [];

      for (const taskData of tasks) {
        const result = await taskStorage.createTask(user_id, {
          task_name: taskData.task_name,
          description: taskData.description || undefined,
          due_date: taskData.due_date || undefined,
          priority: taskData.priority || "medium",
          tags: taskData.tags || [],
          status: "pending",
        });

        if (result) {
          const task = await taskStorage.getTask(user_id, result.taskId);
          if (task) createdTasks.push(task);
        }
      }

      res.json({
        success: true,
        tasks: createdTasks,
        count: createdTasks.length,
        message: `${createdTasks.length} tasks created successfully in Walrus storage`,
      });
    } catch (error) {
      console.error("Error creating bulk tasks:", error);
      next(error);
    }
  },
);

// Get all tasks for user
router.get(
  "/tasks",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.query;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res
          .status(400)
          .json({
            error: "Bad Request",
            detail: "Invalid wallet address format",
          });
        return;
      }

      const taskStorage = getTaskStorageService();
      const tasks = await taskStorage.getTasks(user_id);

      res.json({
        tasks,
        count: tasks.length,
      });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      next(error);
    }
  },
);

// Get single task
router.get(
  "/tasks/:task_id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { task_id } = req.params;
      const { user_id } = req.query;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      const taskStorage = getTaskStorageService();
      const task = await taskStorage.getTask(user_id, task_id);

      if (!task) {
        res.status(404).json({ error: "Not Found", detail: "Task not found" });
        return;
      }

      res.json({ task });
    } catch (error) {
      console.error("Error fetching task:", error);
      next(error);
    }
  },
);

// Update task
router.patch(
  "/tasks/:task_id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { task_id } = req.params;
      const { user_id, ...updates } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      const taskStorage = getTaskStorageService();
      const success = await taskStorage.updateTask(user_id, task_id, updates);

      if (!success) {
        res
          .status(404)
          .json({
            error: "Not Found",
            detail: "Task not found or update failed",
          });
        return;
      }

      const updatedTask = await taskStorage.getTask(user_id, task_id);

      res.json({
        success: true,
        task: updatedTask,
        message: "Task updated successfully",
      });
    } catch (error) {
      console.error("Error updating task:", error);
      next(error);
    }
  },
);

// Delete task
router.delete(
  "/tasks/:task_id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { task_id } = req.params;
      const { user_id } = req.query;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      const taskStorage = getTaskStorageService();
      const success = await taskStorage.deleteTask(user_id, task_id);

      if (!success) {
        res.status(404).json({ error: "Not Found", detail: "Task not found" });
        return;
      }

      res.json({
        success: true,
        message: "Task deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting task:", error);
      next(error);
    }
  },
);

// Complete task
router.post(
  "/tasks/:task_id/complete",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { task_id } = req.params;
      const { user_id } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      const taskStorage = getTaskStorageService();
      const success = await taskStorage.updateTask(user_id, task_id, {
        status: "completed",
      });

      if (!success) {
        res.status(404).json({ error: "Not Found", detail: "Task not found" });
        return;
      }

      res.json({
        success: true,
        message: "Task marked as completed",
      });
    } catch (error) {
      console.error("Error completing task:", error);
      next(error);
    }
  },
);

// Confirm task transaction (for immediate actions like token transfers)
router.post(
  "/tasks/:task_id/confirm",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { task_id } = req.params;
      const { user_id, tx_digest } = req.body;

      if (!user_id || typeof user_id !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "user_id is required" });
        return;
      }

      if (!tx_digest || typeof tx_digest !== "string") {
        res
          .status(400)
          .json({ error: "Bad Request", detail: "tx_digest is required" });
        return;
      }

      console.log(`[TASKS] Task ${task_id} confirmed with tx: ${tx_digest}`);

      const taskStorage = getTaskStorageService();
      await taskStorage.updateTask(user_id, task_id, {
        status: "completed",
        action_status: "completed",
      });

      res.json({
        success: true,
        message: "Task transaction confirmed",
        task_id,
        tx_digest,
      });
    } catch (error) {
      console.error("Error confirming task:", error);
      next(error);
    }
  },
);

// Get task statistics
router.get(
  "/tasks/stats/:user_id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id } = req.params;

      if (!user_id.startsWith("0x") || user_id.length !== 66) {
        res
          .status(400)
          .json({
            error: "Bad Request",
            detail: "Invalid wallet address format",
          });
        return;
      }

      const taskStorage = getTaskStorageService();
      const tasks = await taskStorage.getTasks(user_id);

      const stats = {
        total_tasks: tasks.length,
        pending_tasks: tasks.filter((t) => t.status === "pending").length,
        completed_tasks: tasks.filter((t) => t.status === "completed").length,
        overdue_tasks: tasks.filter(
          (t) =>
            t.status === "pending" &&
            t.due_date &&
            new Date(t.due_date) < new Date(),
        ).length,
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching task stats:", error);
      next(error);
    }
  },
);

export default router;
