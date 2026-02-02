// ============================================================================
// PointsManager - Interact with Tovira Points Smart Contract
// ============================================================================

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

export class PointsManager {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;
  private adminCapId: string;
  private registryId: string;

  constructor() {
    const network = process.env.SUI_NETWORK || "testnet";
    this.client = new SuiClient({
      url: getFullnodeUrl(network as "testnet" | "mainnet"),
    });

    const privateKey = process.env.WALRUS_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("WALRUS_PRIVATE_KEY not set");
    }

    const { secretKey } = decodeSuiPrivateKey(privateKey);
    this.keypair = Ed25519Keypair.fromSecretKey(secretKey);

    this.packageId = process.env.SUI_PACKAGE_ID || "";
    this.adminCapId = process.env.SUI_ADMIN_CAP_ID || "";
    this.registryId = process.env.SUI_REGISTRY_ID || "";

    if (!this.packageId || !this.adminCapId || !this.registryId) {
      throw new Error(
        "Smart contract not deployed. Run: npm run contract:deploy",
      );
    }

    console.log("✅ PointsManager initialized");
    console.log(`   Network: ${network}`);
    console.log(`   Package: ${this.packageId}`);
  }

  /**
   * Mint points to a user
   */
  async mintPoints(
    recipientAddress: string,
    amount: number,
    reason: string = "Tovira Reward",
  ): Promise<string> {
    try {
      console.log(`\n🪙 Minting ${amount} points to ${recipientAddress}...`);
      console.log(`   Reason: ${reason}`);

      const tx = new Transaction();

      // Convert reason to bytes
      const reasonBytes = Array.from(new TextEncoder().encode(reason));

      tx.moveCall({
        target: `${this.packageId}::points::mint_points`,
        arguments: [
          tx.object(this.adminCapId), // AdminCap
          tx.object(this.registryId), // PointsRegistry
          tx.pure.address(recipientAddress), // recipient
          tx.pure.u64(amount), // amount
          tx.pure.vector("u8", reasonBytes), // reason
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      if (result.effects?.status?.status === "success") {
        console.log("✅ Points minted successfully!");
        console.log(`   Transaction: ${result.digest}`);

        // Log event
        const events = result.events || [];
        for (const event of events) {
          if (event.type.includes("PointsMinted")) {
            console.log(
              `   Event: ${JSON.stringify(event.parsedJson, null, 2)}`,
            );
          }
        }

        return result.digest;
      } else {
        throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
      }
    } catch (error) {
      console.error("❌ Failed to mint points:", error);
      throw error;
    }
  }

  /**
   * Batch mint points to multiple users (gas efficient)
   */
  async batchMintPoints(
    recipients: { address: string; amount: number }[],
    reason: string = "Tovira Reward",
  ): Promise<string> {
    try {
      console.log(`\n🪙 Batch minting points to ${recipients.length} users...`);

      const tx = new Transaction();

      const addresses = recipients.map((r) => r.address);
      const amounts = recipients.map((r) => r.amount);
      const reasonBytes = Array.from(new TextEncoder().encode(reason));

      tx.moveCall({
        target: `${this.packageId}::points::batch_mint_points`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.registryId),
          tx.pure.vector("address", addresses),
          tx.pure.vector("u64", amounts),
          tx.pure.vector("u8", reasonBytes),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: {
          showEffects: true,
        },
      });

      if (result.effects?.status?.status === "success") {
        console.log("✅ Batch minting successful!");
        console.log(`   Transaction: ${result.digest}`);
        return result.digest;
      } else {
        throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
      }
    } catch (error) {
      console.error("❌ Failed to batch mint points:", error);
      throw error;
    }
  }

  /**
   * Get user's point balance
   */
  async getBalance(userAddress: string): Promise<number> {
    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_balance`,
        arguments: [tx.object(this.registryId), tx.pure.address(userAddress)],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: userAddress,
        transactionBlock: tx,
      });

      if (result.results && result.results[0]) {
        const returnValues = result.results[0].returnValues;
        if (returnValues && returnValues[0]) {
          const [bytes] = returnValues[0];
          // Parse u64 from bytes (little-endian)
          const view = new DataView(new Uint8Array(bytes).buffer);
          const balance = Number(view.getBigUint64(0, true));
          return balance;
        }
      }

      return 0;
    } catch (error) {
      console.error("Error fetching balance:", error);
      return 0;
    }
  }

  /**
   * Get total supply of points
   */
  async getTotalSupply(): Promise<number> {
    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_total_supply`,
        arguments: [tx.object(this.registryId)],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: this.keypair.getPublicKey().toSuiAddress(),
        transactionBlock: tx,
      });

      if (result.results && result.results[0]) {
        const returnValues = result.results[0].returnValues;
        if (returnValues && returnValues[0]) {
          const [bytes] = returnValues[0];
          const view = new DataView(new Uint8Array(bytes).buffer);
          const supply = Number(view.getBigUint64(0, true));
          return supply;
        }
      }

      return 0;
    } catch (error) {
      console.error("Error fetching total supply:", error);
      return 0;
    }
  }

  /**
   * Check if user has any points
   */
  async hasPoints(userAddress: string): Promise<boolean> {
    const balance = await this.getBalance(userAddress);
    return balance > 0;
  }

  /**
   * Burn points (admin only)
   */
  async burnPoints(userAddress: string, amount: number): Promise<string> {
    try {
      console.log(`\n🔥 Burning ${amount} points from ${userAddress}...`);

      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::burn_points`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.registryId),
          tx.pure.address(userAddress),
          tx.pure.u64(amount),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: {
          showEffects: true,
        },
      });

      if (result.effects?.status?.status === "success") {
        console.log("✅ Points burned successfully!");
        console.log(`   Transaction: ${result.digest}`);
        return result.digest;
      } else {
        throw new Error(`Transaction failed: ${result.effects?.status?.error}`);
      }
    } catch (error) {
      console.error("❌ Failed to burn points:", error);
      throw error;
    }
  }
}
