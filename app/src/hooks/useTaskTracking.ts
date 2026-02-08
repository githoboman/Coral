// src/hooks/useTaskTracking.ts
import { useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { trackTaskCreation } from "@/services/chatService";

/**
 * Hook to track task creation for points
 * Call trackTask() whenever a task is created
 */
export function useTaskTracking() {
  const currentAccount = useCurrentAccount();

  const trackTask = useCallback(async () => {
    if (!currentAccount?.address) {
      console.warn("[TASK TRACKING] No wallet connected");
      return false;
    }

    try {
      await trackTaskCreation(currentAccount.address);
      return true;
    } catch (error) {
      console.error("[TASK TRACKING] Error:", error);
      return false;
    }
  }, [currentAccount?.address]);

  return { trackTask };
}
