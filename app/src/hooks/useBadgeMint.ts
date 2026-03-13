import { useState, useCallback, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_BADGE_PACKAGE_ID || "";
const BADGE_REGISTRY_ID = import.meta.env.VITE_BADGE_REGISTRY_ID || "";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

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

async function fetchUserPoints(address: string): Promise<number> {
  const url = `${API_BASE}/api/leaderboard?wallet_address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Points fetch failed: ${res.status}`);
  const data = await res.json();
  return data.user_rank?.points ?? 0;
}

export function useBadgeMint() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecuteTransaction } =
    useSignAndExecuteTransaction();

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

  const checkPoints = useCallback(async () => {
    if (!currentAccount?.address) return;
    setState((prev) => ({ ...prev, pointsLoading: true }));
    try {
      const points = await fetchUserPoints(currentAccount.address);
      setState((prev) => ({
        ...prev,
        userPoints: points,
        hasEnoughPoints: points >= POINTS_REQUIRED,
        pointsLoading: false,
      }));
    } catch (err) {
      console.error("[useBadgeMint] Failed to fetch points:", err);
      setState((prev) => ({ ...prev, pointsLoading: false }));
    }
  }, [currentAccount?.address]);

  const checkMintStatus = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({ ...prev, status: "idle", hasMinted: false }));
      return;
    }

    setState((prev) => ({ ...prev, status: "checking" }));

    try {
      const registryObj = await suiClient.getObject({
        id: BADGE_REGISTRY_ID,
        options: { showContent: true },
      });
      const content = registryObj.data?.content as any;
      const totalMinted = Number(content?.fields?.total_minted ?? 0);

      const ownedBadges = await suiClient.getOwnedObjects({
        owner: currentAccount.address,
        filter: {
          StructType: `${PACKAGE_ID}::testnet_badge::TestnetBadge`,
        },
        options: { showContent: true },
      });

      const hasMinted = ownedBadges.data.length > 0;
      const badge = ownedBadges.data[0];
      const badgeContent = badge?.data?.content as any;

      setState((prev) => ({
        ...prev,
        status: hasMinted ? "already_minted" : "idle",
        hasMinted,
        badgeId: badge?.data?.objectId ?? null,
        serial: badgeContent?.fields?.serial
          ? Number(badgeContent.fields.serial)
          : null,
        totalMinted,
        error: null,
      }));
    } catch (err: any) {
      console.error("[useBadgeMint] Failed to check mint status:", err);
      setState((prev) => ({ ...prev, status: "idle", error: null }));
    }
  }, [currentAccount?.address, suiClient]);

  useEffect(() => {
    checkMintStatus();
    checkPoints();
  }, [checkMintStatus, checkPoints]);

  const mint = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Connect your wallet first.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, pointsLoading: true }));
    let latestPoints = 0;
    try {
      latestPoints = await fetchUserPoints(currentAccount.address);
    } catch {
      latestPoints = state.userPoints;
    }

    setState((prev) => ({
      ...prev,
      pointsLoading: false,
      userPoints: latestPoints,
      hasEnoughPoints: latestPoints >= POINTS_REQUIRED,
    }));

    if (latestPoints < POINTS_REQUIRED) {
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

  return { mintState: state, mint, checkMintStatus, checkPoints };
}
