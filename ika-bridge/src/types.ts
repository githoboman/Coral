// ============================================================
// types.ts — Shared TypeScript types for the Ika Bridge
// ============================================================

// ---- Chain Identifiers ----

export type ChainId = "sui" | "evm" | "solana";
export type TokenSymbol = "SUI" | "ETH" | "SOL";

export type BridgeRequestStatus =
  | "pending"
  | "signing"
  | "broadcasting"
  | "completed"
  | "failed";

// ---- Bridge Request ----

export interface BridgeRequest {
  id: string;
  sourceChain: ChainId;
  destChain: ChainId;
  senderAddress: string;
  recipientAddress: string;
  /** Source chain amount in base units (gross, before fee) */
  amountIn: bigint;
  /**
   * Destination chain amount in base units.
   * - SUI→ETH/SOL: net ETH/SOL (fee already taken in SUI by contract)
   * - ETH/SOL→SUI: gross MIST — contract takes fee on release_sui()
   */
  amountOut: bigint;
  sourceTxHash: string;
  status: BridgeRequestStatus;
  createdAt: number;
  destTxHash?: string;
  error?: string;
}

// ---- dWallet Info ----

export interface DWalletInfo {
  dWalletId: string;
  dWalletCapId: string;
  encryptedUserSecretKeyShareId: string;
  targetChainAddress: string;
  curve: "SECP256K1" | "ED25519";
  /**
   * Solana durable nonce account address (base58).
   * Required for the Solana dWallet — Ika MPC signing exceeds Solana's
   * blockhash TTL. Create with: pnpm setup:nonce
   */
  nonceAccountAddress?: string;
}

// ---- Bridge State (bridge-state.json) ----

export interface BridgeState {
  evmDWallet: DWalletInfo;
  solanaDWallet: DWalletInfo;
  contract?: {
    packageId: string;
    poolObjectId: string;
    adminCapObjectId: string;
    deployedAt: string;
  };
  updatedAt: string;
}

// ---- Sui Events ----

/**
 * Parsed from Move BridgeLockEvent.
 * net_amount_mist = what actually gets bridged (fee already deducted).
 */
export interface SuiBridgeLockEvent {
  bridgeRequestId: string;
  sender: string;
  destChain: number;
  recipientAddress: string;
  grossAmountMist: string;
  netAmountMist: string;
  feeMist: string;
}

// ---- EVM Events ----

export interface EvmDepositEvent {
  txHash: string;
  from: string;
  amountWei: bigint;
  suiRecipient: string;
  blockNumber: number;
}

// ---- Solana Events ----

export interface SolanaDepositEvent {
  signature: string;
  from: string;
  amountLamports: bigint;
  suiRecipient: string;
  slot: number;
}

// ---- Rate / Fee ----

export interface BridgeRate {
  from: TokenSymbol;
  to: TokenSymbol;
  rate: bigint;
  feeBps: number;
}
