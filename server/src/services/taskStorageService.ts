// server/src/services/taskStorageService.ts
import axios from "axios";
import { getEncryptionService, type EncryptedData } from "./encryptionService";
import { TicketMinter } from "./ticketMinter";
import { WalrusUserManager } from "./walrusUserManager";

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

export interface TaskRegistry {
  version: number;
  user_id: string;
  updated_at: string;
  tasks: Record<string, EncryptedData>; // task_id -> encrypted task data
  active_task_ids: string[];
}

export interface WalrusUploadResponse {
  newlyCreated?: {
    blobObject: {
      blobId: string;
    };
  };
  alreadyCertified?: {
    blobId: string;
  };
}

export class TaskStorageService {
  private publisherUrl: string;
  private aggregatorUrl: string;
  private epochs: number;
  private encryption = getEncryptionService();
  private registryCache: Map<
    string,
    { blobId: string; registry: TaskRegistry }
  > = new Map();

  constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL ||
      "https://publisher.walrus-testnet.walrus.space";
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL ||
      "https://aggregator.walrus-testnet.walrus.space";
    this.epochs = parseInt(process.env.WALRUS_EPOCHS || "50", 10);

    console.log("✅ TaskStorageService initialized");
  }

  // Get user's task registry blob ID from their profile
  private async getUserTaskRegistryBlobId(
    userId: string,
  ): Promise<string | null> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        console.log(`No user registry exists yet`);
        return null;
      }

      const userManager = new WalrusUserManager();
      const userProfile = await userManager.getUserProfile(
        userRegistryBlobId,
        userId,
      );

      if (!userProfile) {
        console.log(`User profile not found for ${userId}`);
        return null;
      }

      return userProfile.task_registry_blob_id || null;
    } catch (error) {
      console.error("Error getting user task registry blob ID:", error);
      throw error;
    }
  }

  // Update user's profile with new task registry blob ID
  private async updateUserTaskRegistryBlobId(
    userId: string,
    taskRegistryBlobId: string,
  ): Promise<boolean> {
    try {
      const ticketMinter = new TicketMinter();
      const userRegistryBlobId = await ticketMinter.getCurrentBlobId();

      if (!userRegistryBlobId) {
        console.error("Cannot update: user registry doesn't exist");
        return false;
      }

      const userManager = new WalrusUserManager();
      const userProfile = await userManager.getUserProfile(
        userRegistryBlobId,
        userId,
      );

      if (!userProfile) {
        console.error(`Cannot update: user profile not found for ${userId}`);
        return false;
      }

      const updatedProfile = userManager.createUserProfile(
        userProfile.email,
        userProfile.wallet_address,
        userProfile.is_waitlisted,
        userProfile.points_awarded,
        {
          username: userProfile.username,
          first_name: userProfile.first_name,
          last_name: userProfile.last_name,
          preferences: userProfile.preferences,
          waitlist_verified_at: userProfile.waitlist_verified_at,
          chat_registry_blob_id: userProfile.chat_registry_blob_id,
          task_registry_blob_id: taskRegistryBlobId,
          tasks_created_today: userProfile.tasks_created_today,
          tasks_claimed_today: userProfile.tasks_claimed_today,
          last_task_reset_date: userProfile.last_task_reset_date,
          subscription_tier: userProfile.subscription_tier,
          subscription_expires_at: userProfile.subscription_expires_at,
          daily_prompts_used: userProfile.daily_prompts_used,
          last_prompt_date: userProfile.last_prompt_date,
          telegram_chat_id: userProfile.telegram_chat_id,
          telegram_username: userProfile.telegram_username,
          telegram_linked_at: userProfile.telegram_linked_at,
        },
      );

      const newUserRegistryBlobId = await userManager.addOrUpdateUser(
        userRegistryBlobId,
        updatedProfile,
      );

      if (!newUserRegistryBlobId) {
        console.error("Failed to update user profile");
        return false;
      }

      if (newUserRegistryBlobId !== userRegistryBlobId) {
        await ticketMinter.updateBlobRegistry(newUserRegistryBlobId);
        console.log(
          `📦 Updated on-chain user registry: ${newUserRegistryBlobId}`,
        );
      }

      return true;
    } catch (error) {
      console.error("Error updating user task registry blob ID:", error);
      return false;
    }
  }

  // Create new task
  async createTask(
    userId: string,
    taskData: Omit<TaskData, "id" | "user_id" | "created_at" | "updated_at">,
  ): Promise<{ taskId: string; registryBlobId: string } | null> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    console.log(`\n🆕 Creating task: ${taskId} for user: ${userId}`);

    const task: TaskData = {
      id: taskId,
      user_id: userId,
      ...taskData,
      created_at: now,
      updated_at: now,
    };

    // Get current registry
    let currentRegistryBlobId: string | null = null;
    try {
      currentRegistryBlobId = await this.getUserTaskRegistryBlobId(userId);
    } catch (error) {
      console.warn(`Could not fetch registry blob ID, assuming none or error: ${error}`);
      // If it was a network error, we should probably fail here too, but for now strictness is in the `get` method.
      // Actually, we MUST fail here if it's a network error, otherwise we overwrite.
      throw error;
    }

    let currentRegistry: TaskRegistry | null = null;

    if (currentRegistryBlobId) {
      currentRegistry = await this.getTaskRegistry(userId);
    }

    // Encrypt task data
    const encryptedTask = this.encryption.encrypt(JSON.stringify(task));

    // Update registry
    const updatedRegistry: TaskRegistry = currentRegistry
      ? {
        ...currentRegistry,
        version: currentRegistry.version + 1,
        updated_at: now,
        tasks: {
          ...currentRegistry.tasks,
          [taskId]: encryptedTask,
        },
        active_task_ids: [...currentRegistry.active_task_ids, taskId],
      }
      : {
        version: 1,
        user_id: userId,
        updated_at: now,
        tasks: {
          [taskId]: encryptedTask,
        },
        active_task_ids: [taskId],
      };

    // Upload registry
    const registryBlobId = await this.uploadRegistry(updatedRegistry);

    if (!registryBlobId) {
      console.error("Failed to upload task registry");
      return null;
    }

    // Cache the registry
    this.registryCache.set(userId, {
      blobId: registryBlobId,
      registry: updatedRegistry,
    });

    // Update user profile
    await this.updateUserTaskRegistryBlobId(userId, registryBlobId);

    console.log(`✅ Task created: ${taskId}`);
    console.log(`   Registry: ${registryBlobId}`);

    return { taskId, registryBlobId };
  }

  // Get task registry
  async getTaskRegistry(userId: string): Promise<TaskRegistry | null> {
    const cached = this.registryCache.get(userId);
    if (cached) {
      console.log(`📋 Using cached task registry for ${userId}`);
      return cached.registry;
    }

    const registryBlobId = await this.getUserTaskRegistryBlobId(userId);
    if (!registryBlobId) {
      console.log(`No task registry exists for user ${userId}`);
      return null;
    }

    try {
      console.log(`📥 Fetching task registry: ${registryBlobId}`);
      const response = await axios.get(
        `${this.aggregatorUrl}/v1/blobs/${registryBlobId}`,
        {
          timeout: 30000,
        },
      );

      const registry = response.data as TaskRegistry;

      this.registryCache.set(userId, {
        blobId: registryBlobId,
        registry,
      });

      console.log(
        `✅ Task registry loaded: ${Object.keys(registry.tasks).length} tasks`,
      );
      return registry;
    } catch (error) {
      console.error(`Error fetching task registry for ${userId}:`, error);
      throw error;
    }
  }

  // Get all tasks for user
  async getTasks(userId: string): Promise<TaskData[]> {
    console.log(`\n📖 Getting tasks for user: ${userId}`);

    const registry = await this.getTaskRegistry(userId);
    if (!registry) {
      return [];
    }

    const tasks = Object.values(registry.tasks).map((encrypted) => {
      const decrypted = this.encryption.decrypt(encrypted);
      return JSON.parse(decrypted) as TaskData;
    });

    // Sort by created_at descending
    tasks.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    console.log(`✅ Loaded ${tasks.length} tasks`);
    return tasks;
  }

  // Get single task
  async getTask(userId: string, taskId: string): Promise<TaskData | null> {
    const registry = await this.getTaskRegistry(userId);
    if (!registry || !registry.tasks[taskId]) {
      return null;
    }

    const decrypted = this.encryption.decrypt(registry.tasks[taskId]);
    return JSON.parse(decrypted) as TaskData;
  }

  // Update task
  async updateTask(
    userId: string,
    taskId: string,
    updates: Partial<TaskData>,
  ): Promise<boolean> {
    const registry = await this.getTaskRegistry(userId);
    if (!registry || !registry.tasks[taskId]) {
      return false;
    }

    const now = new Date().toISOString();

    // Decrypt existing task
    const existingTask = JSON.parse(
      this.encryption.decrypt(registry.tasks[taskId]),
    ) as TaskData;

    // Merge updates
    const updatedTask: TaskData = {
      ...existingTask,
      ...updates,
      updated_at: now,
    };

    // Re-encrypt
    const encryptedTask = this.encryption.encrypt(JSON.stringify(updatedTask));

    // Update registry
    const updatedRegistry: TaskRegistry = {
      ...registry,
      version: registry.version + 1,
      updated_at: now,
      tasks: {
        ...registry.tasks,
        [taskId]: encryptedTask,
      },
    };

    const newRegistryBlobId = await this.uploadRegistry(updatedRegistry);

    if (newRegistryBlobId) {
      this.registryCache.set(userId, {
        blobId: newRegistryBlobId,
        registry: updatedRegistry,
      });
      await this.updateUserTaskRegistryBlobId(userId, newRegistryBlobId);
      return true;
    }

    return false;
  }

  // Delete task
  async deleteTask(userId: string, taskId: string): Promise<boolean> {
    console.log(`\n🗑️ Deleting task: ${taskId}`);

    const registry = await this.getTaskRegistry(userId);
    if (!registry) return false;

    const { [taskId]: removed, ...remainingTasks } = registry.tasks;

    if (!removed) {
      console.log(`Task ${taskId} not found`);
      return false;
    }

    const updatedRegistry: TaskRegistry = {
      ...registry,
      version: registry.version + 1,
      updated_at: new Date().toISOString(),
      tasks: remainingTasks,
      active_task_ids: registry.active_task_ids.filter((id) => id !== taskId),
    };

    const registryBlobId = await this.uploadRegistry(updatedRegistry);

    if (!registryBlobId) return false;

    this.registryCache.set(userId, {
      blobId: registryBlobId,
      registry: updatedRegistry,
    });

    await this.updateUserTaskRegistryBlobId(userId, registryBlobId);

    console.log(`✅ Task deleted: ${taskId}`);

    return true;
  }

  // Helper: Upload registry
  private async uploadRegistry(registry: TaskRegistry): Promise<string | null> {
    try {
      const registryJson = JSON.stringify(registry);

      const response = await axios.put(
        `${this.publisherUrl}/v1/blobs`,
        registryJson,
        {
          headers: { "Content-Type": "application/json" },
          params: { epochs: this.epochs },
          timeout: 30000,
        },
      );

      const result = response.data as WalrusUploadResponse;
      return (
        result.newlyCreated?.blobObject?.blobId ||
        result.alreadyCertified?.blobId ||
        null
      );
    } catch (error) {
      console.error("Error uploading task registry:", error);
      return null;
    }
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
