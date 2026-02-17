
import dotenv from "dotenv";
dotenv.config();

import { getSubscriptionService } from "./src/services/subscriptionService";

const userId = "0x" + "5".repeat(64); // User 5 for memory cache test

async function run() {
  const service = getSubscriptionService();

  console.log("--- Initial State ---");
  const initial = await service.getPromptsRemaining(userId);
  console.log("Initial:", initial);

  console.log("\n--- Tracking Usage 1 ---");
  const success1 = await service.trackPromptUsage(userId);
  console.log(`Tracking success: ${success1}`);
  const after1 = await service.getPromptsRemaining(userId);
  console.log("After 1:", after1);

  console.log("\n--- Tracking Usage 2 ---");
  const success2 = await service.trackPromptUsage(userId);
  console.log(`Tracking success: ${success2}`);
  const after2 = await service.getPromptsRemaining(userId);
  console.log("After 2:", after2);

  console.log("\n--- Tracking Usage 3 ---");
  const success3 = await service.trackPromptUsage(userId);
  console.log(`Tracking success: ${success3}`);

  console.log("\n--- Checking Can Use ---");
  const canUse = await service.canUsePrompt(userId);
  console.log("Can Use (should be false):", canUse);
}

run();
