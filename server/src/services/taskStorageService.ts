import { getSupabaseClient } from "../config/supabase";

export interface TaskData {
  id: string;
  user_id: string;
  task_name: string;
  description?: string;
  due_date?: string;
  priority: "low" | "medium" | "high";
  tags: string[];
  status: "pending" | "completed";
  action_type?: "reminder" | "token_transfer" | "dca_purchase" | "token_swap";
  action_params?: any;
  action_status?: string;
  created_at: string;
  updated_at: string;
  due_notification_sent?: boolean;
}

export class TaskStorageService {
  private supabase = getSupabaseClient();

  constructor() {
    // No initialization needed for Supabase client
  }

  // Create new task
  async createTask(
    userId: string,
    taskData: Omit<TaskData, "id" | "user_id" | "created_at" | "updated_at">,
  ): Promise<{ taskId: string; registryBlobId: string } | null> {
    try {
      // Omit ID to let Postgres generate it (bigserial)
      const { data, error } = await this.supabase
        .from("tasks")
        .insert({
          user_id: userId,
          task_name: taskData.task_name,
          description: taskData.description,
          due_date: taskData.due_date,
          priority: taskData.priority,
          tags: taskData.tags,
          status: taskData.status,
          action_type: taskData.action_type,
          action_params: taskData.action_params,
          action_status: taskData.action_status,
          due_notification_sent: taskData.due_notification_sent
        })
        .select()
        .single();

      if (error) {
        console.error("Supabase create task error:", error);
        return null;
      }

      const taskId = data.id.toString(); // Convert bigserial to string

      // We return a dummy registryBlobId to maintain interface compatibility 
      // with existing callers until they are refactored
      return { taskId, registryBlobId: "supabase-managed" };
    } catch (err) {
      console.error("Create task exception:", err);
      return null;
    }
  }

  // Get all tasks for user
  async getTasks(userId: string): Promise<TaskData[]> {
    try {
      const { data, error } = await this.supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Supabase get tasks error:", error);
        return [];
      }

      return data.map((t: any) => ({
        ...t,
        id: t.id.toString(), // Ensure ID is string
        tags: t.tags || [],
        action_params: t.action_params || undefined
      })) as TaskData[];
    } catch (err) {
      console.error("Get tasks exception:", err);
      return [];
    }
  }

  // Get single task
  async getTask(userId: string, taskId: string): Promise<TaskData | null> {
    try {
      const numericId = parseInt(taskId, 10);
      if (isNaN(numericId)) return null;

      const { data, error } = await this.supabase
        .from("tasks")
        .select("*")
        .eq("id", numericId)
        .eq("user_id", userId) // Security check
        .single();

      if (error || !data) {
        return null;
      }

      return {
        ...data,
        id: data.id.toString(),
        tags: data.tags || [],
        action_params: data.action_params || undefined
      } as TaskData;
    } catch (err) {
      console.error("Get task exception:", err);
      return null;
    }
  }

  // Update task
  async updateTask(
    userId: string,
    taskId: string,
    updates: Partial<TaskData>,
  ): Promise<boolean> {
    try {
      const numericId = parseInt(taskId, 10);
      if (isNaN(numericId)) return false;

      // Filter out non-updatable fields or undefineds
      const cleanUpdates: any = { ...updates };
      delete cleanUpdates.id;
      delete cleanUpdates.user_id;
      delete cleanUpdates.created_at;
      cleanUpdates.updated_at = new Date().toISOString();

      const { error } = await this.supabase
        .from("tasks")
        .update(cleanUpdates)
        .eq("id", numericId)
        .eq("user_id", userId);

      if (error) {
        console.error("Supabase update task error:", error);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Update task exception:", err);
      return false;
    }
  }

  // Delete task
  async deleteTask(userId: string, taskId: string): Promise<boolean> {
    try {
      const numericId = parseInt(taskId, 10);
      if (isNaN(numericId)) return false;

      const { error } = await this.supabase
        .from("tasks")
        .delete()
        .eq("id", numericId)
        .eq("user_id", userId);

      if (error) {
        console.error("Supabase delete task error:", error);
        return false;
      }

      return true;
    } catch (err) {
      console.error("Delete task exception:", err);
      return false;
    }
  }

  // Deprecated methods kept for temporary compatibility if needed, 
  // currently stubbed to prevent errors during transition
  async getTaskRegistry(userId: string): Promise<any | null> {
    return null;
  }
}

// Singleton
let taskStorageService: TaskStorageService | null = null;

export function getTaskStorageService(): TaskStorageService {
  if (!taskStorageService) {
    taskStorageService = new TaskStorageService();
  }
  return taskStorageService;
}
