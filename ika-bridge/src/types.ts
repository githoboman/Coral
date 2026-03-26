export type ChainId = "sui" | "evm" | "solana";
export type TokenSymbol = "SUI" | "ETH" | "SOL";

export type BridgeRequestStatus =
  | "pending"
  | "signing"
  | "broadcasting"
  | "completed"
  | "failed";

export interface BridgeRequest {
  id: string;
  sourceChain: ChainId;
  destChain: ChainId;
  senderAddress: string;
  recipientAddress: string;
  amountIn: bigint;
  amountOut: bigint;
  sourceTxHash: string;
  status: BridgeRequestStatus;
  createdAt: number;
  destTxHash?: string;
  error?: string;
}

export interface DWalletInfo {
  dWalletId: string;
  dWalletCapId: string;
  encryptedUserSecretKeyShareId: string;
  targetChainAddress: string;
  curve: "SECP256K1" | "ED25519";

  nonceAccountAddress?: string;
}

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

export interface SuiBridgeLockEvent {
  bridgeRequestId: string;
  sender: string;
  destChain: number;
  recipientAddress: string;
  grossAmountMist: string;
  netAmountMist: string;
  feeMist: string;
}

export interface EvmDepositEvent {
  txHash: string;
  from: string;
  amountWei: bigint;
  suiRecipient: string;
  blockNumber: number;
}

export interface SolanaDepositEvent {
  signature: string;
  from: string;
  amountLamports: bigint;
  suiRecipient: string;
  slot: number;
}

export interface BridgeRate {
  from: TokenSymbol;
  to: TokenSymbol;
  rate: bigint;
  feeBps: number;
}
