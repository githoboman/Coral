import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${key}\n` +
        `   Please copy .env.example to .env and fill in your values.`,
    );
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  ika: {
    network: optionalEnv("IKA_NETWORK", "localnet") as
      | "localnet"
      | "testnet"
      | "mainnet",

    get suiRpcUrl(): string {
      if (process.env.SUI_RPC_URL) return process.env.SUI_RPC_URL;
      const network = this.network;
      if (network === "localnet") return "http://127.0.0.1:9000";
      if (network === "testnet") return "https://fullnode.testnet.sui.io";
      return "https://fullnode.mainnet.sui.io";
    },

    suiPrivateKey: requireEnv("SUI_PRIVATE_KEY"),
    bridgeSeed: requireEnv("BRIDGE_SEED"),
    stateFile: optionalEnv("BRIDGE_STATE_FILE", "./bridge-state.json"),
  },

  evm: {
    rpcUrl: requireEnv("EVM_RPC_URL"),
    wsUrl: requireEnv("EVM_WS_URL"),
    chainId: parseInt(optionalEnv("EVM_CHAIN_ID", "31337")),
    deployerPrivateKey: optionalEnv("EVM_DEPLOYER_PRIVATE_KEY", ""),
    bridgeContractAddress: optionalEnv("EVM_BRIDGE_CONTRACT_ADDRESS", ""),
    confirmations: parseInt(optionalEnv("EVM_CONFIRMATIONS", "1")),
  },

  solana: {
    rpcUrl: requireEnv("SOLANA_RPC_URL"),
    wsUrl: requireEnv("SOLANA_WS_URL"),
    confirmations: parseInt(optionalEnv("SOLANA_CONFIRMATIONS", "1")),
  },

  bridge: {
    minAmountSui: BigInt(optionalEnv("MIN_BRIDGE_AMOUNT_SUI", "10000000")),
    minAmountEth: BigInt(optionalEnv("MIN_BRIDGE_AMOUNT_ETH", "1000000000000")),
    minAmountSol: BigInt(optionalEnv("MIN_BRIDGE_AMOUNT_SOL", "100000")),

    maxAmountSui: BigInt(optionalEnv("MAX_BRIDGE_AMOUNT_SUI", "1000000000")), // 1 SUI
    maxAmountEth: BigInt(
      optionalEnv("MAX_BRIDGE_AMOUNT_ETH", "100000000000000"),
    ), // 0.0001 ETH
    maxAmountSol: BigInt(optionalEnv("MAX_BRIDGE_AMOUNT_SOL", "2000000")), // 0.002 SOL

    rateSuiToEth: BigInt(optionalEnv("RATE_SUI_TO_ETH", "449000000000000")),
    rateSuiToSol: BigInt(optionalEnv("RATE_SUI_TO_SOL", "10590000")),
    feeBps: parseInt(optionalEnv("BRIDGE_FEE_BPS", "30")),
  },

  server: {
    port: parseInt(optionalEnv("SERVER_PORT", "3001")),
    adminKey: requireEnv("ADMIN_API_KEY"),
  },

  redis: {
    url: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  },

  relayer: {
    suiPollIntervalMs: parseInt(optionalEnv("SUI_POLL_INTERVAL_MS", "3000")),
    solanaPollIntervalMs: parseInt(
      optionalEnv("SOLANA_POLL_INTERVAL_MS", "5000"),
    ),
    maxQueueSize: parseInt(optionalEnv("MAX_QUEUE_SIZE", "100")),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
  },
} as const;

export function calculateBridgeOutput(
  amountIn: bigint,
  rate: bigint,
  feeBps: number,
): bigint {
  const outRaw = (amountIn * rate) / 1_000_000_000n;
  const out = (outRaw * BigInt(10000 - feeBps)) / 10000n;
  return out;
}

export type BridgeConfig = typeof config;
