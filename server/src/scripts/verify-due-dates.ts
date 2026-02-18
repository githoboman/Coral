
import { TicketMinter } from "../services/ticketMinter";
import { getTaskStorageService } from "../services/taskStorageService";
import { getTaskScheduler } from "../services/scheduler";
import "dotenv/config";

// Mock notification service to avoid spamming real channels
const mockNotificationService = {
  sendTaskDueNotification: async (userId: string, task: any) => {
    console.log(`[TEST] 🔔 Notification sent for task "${task.task_name}" (Due: ${task.due_date})`);
    return true;
  }
};

// We need to hijack the notification service instance in the scheduler
// Accessing private property via any cast
const scheduler = getTaskScheduler();
(scheduler as any).notificationService = mockNotificationService;

async function testSmartDates() {
  const userId = "test_user_dates";
  const storage = getTaskStorageService();

  console.log("\n--- TEST START: Intelligent Due Dates ---");

  // 1. Create a task manually with NO due date (Simulating what the Agent would do *before* my fix, 
  //    but since I fixed the Agent, I should test the Agent's output. 
  //    However, testing the Agent is complex (LLM). 
  //    Let's verify the SCHEDULER logic first.

  // Create a task that is "Due Now"
  const now = new Date();
  const pastDate = new Date(now.getTime() - 1000).toISOString(); // 1 second ago

  console.log(`[TEST] Creating task due "Now": ${pastDate}`);
  const t1 = await storage.createTask(userId, {
    task_name: "Test Recurring Task",
    priority: "high",
    tags: [],
    status: "pending",
    due_date: pastDate,
    due_notification_sent: false
  });

  if (!t1) throw new Error("Failed to create task");

  // 2. Run the scheduler (force private method trigger)
  console.log("[TEST] Running Scheduler Check...");
  await (scheduler as any).processUserTasks(userId);

  // 3. Verify Rescheduling
  const updatedTask = await storage.getTask(userId, t1.taskId);
  if (!updatedTask) throw new Error("Task vanished");

  const newDueDate = new Date(updatedTask.due_date!);
  const diffHours = (newDueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  console.log(`[TEST] Task rescheduled to: ${updatedTask.due_date}`);
  console.log(`[TEST] Difference from now: ${diffHours.toFixed(2)} hours`);

  if (diffHours > 23 && diffHours < 25) {
    console.log("[TEST] ✅ SUCCESS: Task was rescheduled for ~24 hours later!");
  } else {
    console.error("[TEST] ❌ FAILURE: Task was not rescheduled correctly.");
  }

  // Cleanup
  await storage.deleteTask(userId, t1.taskId);
}

testSmartDates().catch(console.error);
