import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphql } from "@mysten/sui/graphql/schemas/2024.4";

const client = new SuiGraphQLClient({
  url: "https://sui-mainnet.mystenlabs.io/graphql",
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

// Export all Sui tools
export const suiTools = [suiObjectLookup, suiCoinMetadata];
