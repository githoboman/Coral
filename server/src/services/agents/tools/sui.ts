import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schemas/2024.4";

const network = (process.env.VITE_SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet';
const client = new SuiGraphQLClient({
  url: network === 'mainnet'
    ? "https://sui-mainnet.mystenlabs.io/graphql"
    : "https://sui-testnet.mystenlabs.io/graphql",
});

// Tool to query Sui objects by address
export const suiObjectLookup = tool(
  async ({ address }: { address: string }) => {
    try {
      const result = await client.query({
        query: graphql(`
          query ObjectQuery($address: SuiAddress!) {
            object(address: $address) {
              address
              version
              digest
              owner {
                __typename
                ... on AddressOwner {
                  owner {
                    address
                  }
                }
              }
              storageRebate
              asMoveObject {
                contents {
                  type {
                    repr
                  }
                  json
                }
              }
            }
          }
        `),
        variables: { address },
      });

      return JSON.stringify(result.data, null, 2);
    } catch (error) {
      console.error("Sui object lookup error:", error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to query Sui object"
      });
    }
  },
  {
    name: "sui_object_lookup",
    description: "Query Sui blockchain for object data by address. Use this to get on-chain information about NFTs, tokens, smart contracts, or any Sui object.",
    schema: z.object({
      address: z.string().describe("The Sui object address to query (0x... format)"),
    }),
  }
);

// Tool to get coin metadata
export const suiCoinMetadata = tool(
  async ({ coinType }: { coinType: string }) => {
    try {
      const result = await client.query({
        query: graphql(`
          query CoinMetadata($coinType: String!) {
            coinMetadata(coinType: $coinType) {
              decimals
              name
              symbol
              description
              iconUrl
              supply
            }
          }
        `),
        variables: { coinType },
      });

      return JSON.stringify(result.data, null, 2);
    } catch (error) {
      console.error("Sui coin metadata error:", error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to query coin metadata"
      });
    }
  },
  {
    name: "sui_coin_metadata",
    description: "Get metadata for a Sui coin/token including name, symbol, decimals, and supply. Use the full coin type (e.g., '0x2::sui::SUI').",
    schema: z.object({
      coinType: z.string().describe("The full coin type identifier"),
    }),
  }
);

// Tool to get wallet balance
export const getWalletBalance = tool(
  async ({ address }: { address: string }) => {
    try {
      const result = await client.query({
        query: graphql(`
          query WalletBalance($address: SuiAddress!) {
            address(address: $address) {
              balance(type: "0x2::sui::SUI") {
                totalBalance
              }
            }
          }
        `),
        variables: { address },
      });

      const totalBalance = result.data?.address?.balance?.totalBalance || "0";
      // Convert MIST to SUI for easier reading by the agent
      const suiBalance = (BigInt(totalBalance) / BigInt(1e9)).toString() + "." + (BigInt(totalBalance) % BigInt(1e9)).toString().padStart(9, '0');

      return JSON.stringify({
        address,
        totalBalanceMist: totalBalance,
        totalBalanceSui: parseFloat(suiBalance).toString(), // Trim trailing zeros
        network
      }, null, 2);
    } catch (error) {
      console.error("Get wallet balance error:", error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to query wallet balance"
      });
    }
  },
  {
    name: "get_wallet_balance",
    description: "Get the SUI balance of a wallet address. Use this whenever the user asks about their funds, 'how much I have', or when you need to know if a transaction is feasible.",
    schema: z.object({
      address: z.string().describe("The Sui wallet address to check (0x... format)"),
    }),
  }
);

// Export all Sui tools
export const suiTools = [suiObjectLookup, suiCoinMetadata, getWalletBalance];

/**
 * Helper to fetch balance directly (for state initialization)
 */
export async function fetchBalanceDirect(address: string): Promise<{ totalBalanceMist: string; totalBalanceSui: string }> {
  try {
    const result = await client.query({
      query: graphql(`
        query WalletBalance($address: SuiAddress!) {
          address(address: $address) {
            balance(type: "0x2::sui::SUI") {
              totalBalance
            }
          }
        }
      `),
      variables: { address },
    });

    const totalBalance = result.data?.address?.balance?.totalBalance || "0";
    const whole = BigInt(totalBalance) / BigInt(1e9);
    const frac = BigInt(totalBalance) % BigInt(1e9);
    const suiBalance = frac > 0
      ? `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`
      : whole.toString();

    return {
      totalBalanceMist: totalBalance,
      totalBalanceSui: suiBalance
    };
  } catch (error) {
    console.error("Direct balance fetch error:", error);
    return { totalBalanceMist: "0", totalBalanceSui: "0" };
  }
}
