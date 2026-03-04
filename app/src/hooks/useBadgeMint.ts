import { useState, useCallback, useEffect } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

const PACKAGE_ID = import.meta.env.VITE_SUI_BADGE_PACKAGE_ID || "";
const BADGE_REGISTRY_ID = import.meta.env.VITE_BADGE_REGISTRY_ID || "";

export type MintStatus =
  | "idle"
  | "checking"
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
  });

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
      console.error("Failed to check mint status:", err);
      setState((prev) => ({ ...prev, status: "idle", error: null }));
    }
  }, [currentAccount?.address, suiClient]);

  useEffect(() => {
    checkMintStatus();
  }, [checkMintStatus]);

  const mint = useCallback(async () => {
    if (!currentAccount?.address) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Connect your wallet first.",
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
      console.error("Mint error:", err);

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
  ]);

  return {
    mintState: state,
    mint,
    checkMintStatus,
  };
}
