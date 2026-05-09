import { useState, useCallback, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeaderboard } from "@/store/slices/leaderboardSlice";
import { fetchBadgeStatus } from "@/store/slices/badgeMintSlice";

const PACKAGE_ID = import.meta.env.VITE_SUI_BADGE_PACKAGE_ID || "";
const BADGE_REGISTRY_ID = import.meta.env.VITE_BADGE_REGISTRY_ID || "";

export const POINTS_REQUIRED = 200;

export type MintStatus =
  | "idle"
  | "checking"
  | "insufficient_points"
  | "already_minted"
  | "signing"
  | "confirming"
  | "success"
  | "error";

export interface BadgeMintState {
  status: MintStatus;
  hasMinted: boolean;
  badgeId: string | null;
  serial: number | null;
  error: string | null;
  totalMinted: number;
  userPoints: number;
  pointsLoading: boolean;
  hasEnoughPoints: boolean;
}

export function useBadgeMint() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const dispatch = useAppDispatch();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

  // Redux state
  const userRank = useAppSelector(state => state.leaderboard.userRank);
  const leaderboardLoading = useAppSelector(state => state.leaderboard.loading);
  const badgeInfo = useAppSelector(state => state.badgeMint.info);

  const [state, setState] = useState<BadgeMintState>({
    status: "idle",
    hasMinted: false,
    badgeId: null,
    serial: null,
    error: null,
    totalMinted: 0,
    userPoints: 0,
    pointsLoading: false,
    hasEnoughPoints: false,
  });

  // Sync with Redux
  useEffect(() => {
    if (badgeInfo) {
      setState(prev => ({
        ...prev,
        hasMinted: badgeInfo.hasMinted,
        badgeId: badgeInfo.badgeId,
        serial: badgeInfo.serial,
        totalMinted: badgeInfo.totalMinted,
        status: badgeInfo.hasMinted ? "already_minted" : (prev.status === "already_minted" ? "idle" : prev.status)
      }));
    }
  }, [badgeInfo]);

  useEffect(() => {
    const points = userRank?.points ?? 0;
    setState(prev => ({
      ...prev,
      userPoints: points,
      hasEnoughPoints: points >= POINTS_REQUIRED,
      pointsLoading: leaderboardLoading
    }));
  }, [userRank, leaderboardLoading]);

  const checkPoints = useCallback(async () => {
    if (!currentAccount?.address) return;
    dispatch(fetchLeaderboard({ walletAddress: currentAccount.address }));
  }, [currentAccount?.address, dispatch]);

  const checkMintStatus = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({ ...prev, status: "idle", hasMinted: false }));
      return;
    }

    dispatch(fetchBadgeStatus({
      address: currentAccount.address,
      suiClient,
      packageId: PACKAGE_ID,
      registryId: BADGE_REGISTRY_ID
    }));
  }, [currentAccount?.address, suiClient, dispatch]);

  useEffect(() => {
    if (currentAccount?.address) {
      checkMintStatus();
      checkPoints();
    }
  }, [currentAccount?.address, checkMintStatus, checkPoints]);

  const mint = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Connect your wallet first.",
      }));
      return;
    }

    // Ensure points are up to date before minting
    await dispatch(fetchLeaderboard({ forceRefresh: true, walletAddress: currentAccount.address })).unwrap();
    
    // We get latest points from the updated state via the selector, but for logic here:
    // (Note: we could also use the value from unwrap())
    const points = userRank?.points ?? 0;

    if (points < POINTS_REQUIRED) {
      setState((prev) => ({
        ...prev,
        status: "insufficient_points",
        error: null,
      }));
      return;
    }

    setState((prev) => ({ ...prev, status: "signing", error: null }));

    try {
      const tx = new Transaction();
      tx.setGasBudget(20_000_000);

      tx.moveCall({
        target: `${PACKAGE_ID}::testnet_badge::mint`,
        arguments: [tx.object(BADGE_REGISTRY_ID)],
      });

      setState((prev) => ({ ...prev, status: "confirming" }));

      const result = await signAndExecuteTransaction(
        { transaction: tx },
        { onSuccess: () => {}, onError: () => {} },
      );

      const confirmed = await suiClient.waitForTransaction({
        digest: result.digest,
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });

      const execStatus = confirmed.effects?.status?.status;
      const execError = confirmed.effects?.status?.error ?? "";

      if (execStatus !== "success") {
        const errStr = execError.toLowerCase();
        let userMsg = "Mint failed. Please try again.";

        if (
          errStr.includes("ealready_minted") ||
          errStr.includes("aborted, 1")
        ) {
          userMsg = "You've already minted your Testnet Badge!";
        } else if (
          errStr.includes("eminting_paused") ||
          errStr.includes("aborted, 2")
        ) {
          userMsg = "Minting is currently paused. Check back soon.";
        } else if (errStr.includes("gas") || errStr.includes("insufficient")) {
          userMsg = "Not enough SUI for gas. Add SUI to your wallet.";
        } else if (execError) {
          userMsg = execError;
        }

        setState((prev) => ({ ...prev, status: "error", error: userMsg }));
        return;
      }

      const badgeChange = confirmed.objectChanges?.find(
        (c: any) =>
          c.type === "created" &&
          c.objectType?.includes("testnet_badge::TestnetBadge"),
      );

      let serial: number | null = null;
      let badgeId = (badgeChange as any)?.objectId ?? null;

      if (badgeId) {
        try {
          const badgeObj = await suiClient.getObject({
            id: badgeId,
            options: { showContent: true },
          });
          const fields = (badgeObj.data?.content as any)?.fields;
          serial = fields?.serial ? Number(fields.serial) : null;
        } catch (_) {}
      }

      let totalMinted = state.totalMinted;
      try {
        const reg = await suiClient.getObject({
          id: BADGE_REGISTRY_ID,
          options: { showContent: true },
        });
        totalMinted = Number(
          (reg.data?.content as any)?.fields?.total_minted ?? totalMinted,
        );
      } catch (_) {}

      setState((prev) => ({
        ...prev,
        status: "success",
        hasMinted: true,
        badgeId,
        serial,
        totalMinted,
        error: null,
      }));
    } catch (err: any) {
      console.error("[useBadgeMint] Mint error:", err);
      let errorMsg = "Mint failed. Please try again.";
      const msg = (err?.message || "").toLowerCase();

      if (msg.includes("rejected") || msg.includes("cancelled")) {
        errorMsg = "Transaction cancelled.";
      } else if (msg.includes("gas") || msg.includes("insufficient")) {
        errorMsg = "Not enough SUI for gas fees.";
      } else if (err?.message) {
        errorMsg = err.message;
      }

      setState((prev) => ({ ...prev, status: "error", error: errorMsg }));
    }
  }, [
    currentAccount?.address,
    signAndExecuteTransaction,
    suiClient,
    state.totalMinted,
    state.userPoints,
  ]);

  return {
    ...state,
    mint,
    checkMintStatus,
    checkPoints,
  };
}
