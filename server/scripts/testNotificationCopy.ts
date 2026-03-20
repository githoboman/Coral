import 'dotenv/config';
import { getNotificationCopyService } from '../src/services/notificationCopyService.js';

async function test() {
  const service = getNotificationCopyService();
  
  const dummyTask1 = {
    task_name: "Check Solana balance",
    description: "",
    due_date: new Date(Date.now() + 2 * 60 * 1000).toISOString() // in 2 minutes
  };

  const dummyTask2 = {
    task_name: "Call dentist",
    description: "Book the appointment for the cleaning",
    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // tomorrow
  };

  console.log("Testing Task 1 (No description, +2 mins)...");
  const copy1 = await service.generateCopy(dummyTask1, new Date());
  console.log(copy1);

  console.log("\nTesting Task 2 (With description, +24 hours)...");
  const copy2 = await service.generateCopy(dummyTask2, new Date());
  console.log(copy2);

  console.log("\nTesting Fallback (invalid API key)...");
  // Temporarily mess up the API key to force a fallback
  // @ts-ignore
  process.env.GEMINI_API_KEY = "invalid";
  // @ts-ignore
  process.env.GEMINI_API_KEY_TASK = "invalid";
  const dummyTask3 = {
    task_name: "Buy Milk",
    description: "",
    due_date: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() // in 3 hours
  };
  const copy3 = await service.generateCopy(dummyTask3, new Date());
  console.log(copy3);
}

test().catch(console.error);
