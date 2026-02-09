import { useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { trackTaskCreation } from "@/services/chatService";

export function useTaskTracking() {
  const currentAccount = useCurrentAccount();

  const trackTask = useCallback(async () => {
    if (!currentAccount?.address) {
      return false;
    }

    try {
      await trackTaskCreation(currentAccount.address);
      return true;
    } catch (error) {
      return false;
    }
  }, [currentAccount?.address]);

  return { trackTask };
}
