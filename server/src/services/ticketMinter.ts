// src/services/ticketMinter.ts — UPDATED WITH CHECK-IN SUPPORT
//
// Added methods:
//   - getLastCheckin(wallet) → timestamp of last check-in (0 if never)
//   - canCheckin(wallet) → boolean (true if cooldown passed or never checked in)

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

interface PointsClaimedEvent {
  wallet_address: string;
  amount: string;
  reason: string;
  new_balance: string;
  timestamp: string;
}

interface CheckInCompletedEvent {
  wallet_address: string;
  points_earned: string;
  new_balance: string;
  timestamp: string;
  next_checkin_available: string;
}

export class TicketMinter {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;
  private adminCapId: string;
  private pointsRegistryId: string;
  private blobRegistryId: string;

  constructor() {
    const network = process.env.SUI_NETWORK || "testnet";
    this.client = new SuiClient({
      url: getFullnodeUrl(network as "testnet" | "mainnet"),
    });

    const privateKey = process.env.WALRUS_PRIVATE_KEY;
    if (!privateKey) throw new Error("WALRUS_PRIVATE_KEY not set");

    const { secretKey } = decodeSuiPrivateKey(privateKey);
    this.keypair = Ed25519Keypair.fromSecretKey(secretKey);

    this.packageId = process.env.SUI_PACKAGE_ID || "";
    this.adminCapId = process.env.SUI_ADMIN_CAP_ID || "";
    this.pointsRegistryId = process.env.SUI_POINTS_REGISTRY_ID || "";
    this.blobRegistryId = process.env.SUI_BLOB_REGISTRY_ID || "";

    if (
      !this.packageId ||
      !this.adminCapId ||
      !this.pointsRegistryId ||
      !this.blobRegistryId
    ) {
      throw new Error(
        "Missing env vars. Set: SUI_PACKAGE_ID, SUI_ADMIN_CAP_ID, " +
          "SUI_POINTS_REGISTRY_ID, SUI_BLOB_REGISTRY_ID",
      );
    }

    console.log("✅ TicketMinter initialized");
    console.log(`   Network:         ${network}`);
    console.log(`   Package:         ${this.packageId}`);
    console.log(`   PointsRegistry:  ${this.pointsRegistryId}`);
    console.log(`   BlobRegistry:    ${this.blobRegistryId}`);
  }

  private normalizeAddress(addr: string): string {
    const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
    return "0x" + hex.padStart(64, "0");
  }

  // =========================================================================
  // DIGEST-BASED VERIFICATION (instant confirmation after tx)
  // =========================================================================
  async verifyClaimByDigest(digest: string): Promise<{
    confirmed: boolean;
    balance: number;
    amount: number;
    timestamp: string;
  } | null> {
    try {
      console.log(`\n🔎 Verifying claim via tx digest: ${digest}`);

      const tx = await this.client.getTransactionBlock({
        digest,
        options: {
          showEvents: true,
          showEffects: true,
        },
      });

      if (tx.effects?.status?.status !== "success") {
        console.warn("⚠️  Transaction was not successful:", tx.effects?.status);
        return null;
      }

      const events = tx.events || [];

      // Try PointsClaimed event first
      let claimEvent = events.find(
        (e) => e.type === `${this.packageId}::points::PointsClaimed`,
      );

      if (claimEvent) {
        const data = claimEvent.parsedJson as unknown as PointsClaimedEvent;
        console.log(`✅ Claim verified on-chain:`, data);

        return {
          confirmed: true,
          balance: Number(data.new_balance),
          amount: Number(data.amount),
          timestamp: data.timestamp,
        };
      }

      // Try CheckInCompleted event
      const checkinEvent = events.find(
        (e) => e.type === `${this.packageId}::points::CheckInCompleted`,
      );

      if (checkinEvent) {
        const data =
          checkinEvent.parsedJson as unknown as CheckInCompletedEvent;
        console.log(`✅ Check-in verified on-chain:`, data);

        return {
          confirmed: true,
          balance: Number(data.new_balance),
          amount: Number(data.points_earned),
          timestamp: data.timestamp,
        };
      }

      console.warn("⚠️  No claim or check-in event in transaction");
      return null;
    } catch (error) {
      console.error("❌ verifyClaimByDigest error:", error);
      return null;
    }
  }

  // =========================================================================
  // MINT ELIGIBILITY TICKET
  // =========================================================================
  async mintTicket(
    walletAddress: string,
    pointsAmount: number,
    reason: string = "Waitlist Bonus",
  ): Promise<string | null> {
    try {
      console.log(
        `\n🎟️  Minting ticket → ${walletAddress} (${pointsAmount} pts, ${reason})`,
      );

      const tx = new Transaction();
      const reasonBytes = Array.from(new TextEncoder().encode(reason));

      tx.moveCall({
        target: `${this.packageId}::points::mint_eligibility_ticket`,
        arguments: [
          tx.object(this.adminCapId),
          tx.pure.address(walletAddress),
          tx.pure.u64(pointsAmount),
          tx.pure.vector("u8", reasonBytes),
          tx.object("0x6"),
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

      if (result.effects?.status?.status !== "success") {
        console.error("❌ Ticket mint failed:", result.effects?.status?.error);
        return null;
      }

      const created = result.effects?.created;
      if (created && created.length > 0) {
        const ticketRef = created[0];
        const ticketId =
          typeof ticketRef === "string"
            ? ticketRef
            : (ticketRef as any).reference?.objectId ||
              (ticketRef as any).objectId;

        console.log(`✅ Ticket minted: ${ticketId}  tx=${result.digest}`);
        return ticketId;
      }

      console.warn("⚠️  Tx succeeded but no created object found");
      return null;
    } catch (error) {
      console.error("❌ mintTicket error:", error);
      throw error;
    }
  }

  // =========================================================================
  // UPDATE BLOB REGISTRY
  // =========================================================================
  async updateBlobRegistry(newBlobId: string): Promise<string | null> {
    try {
      console.log(`\n📦 Updating BlobRegistry → ${newBlobId}`);

      const tx = new Transaction();
      const blobBytes = Array.from(new TextEncoder().encode(newBlobId));

      tx.moveCall({
        target: `${this.packageId}::points::update_blob_id`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.blobRegistryId),
          tx.pure.vector("u8", blobBytes),
          tx.object("0x6"),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === "success") {
        console.log(`✅ BlobRegistry updated  tx=${result.digest}`);
        return result.digest;
      }

      console.error(
        "❌ BlobRegistry update failed:",
        result.effects?.status?.error,
      );
      return null;
    } catch (error) {
      console.error("❌ updateBlobRegistry error:", error);
      throw error;
    }
  }

  // =========================================================================
  // READ: hasClaimed
  // =========================================================================
  async hasClaimed(walletAddress: string): Promise<boolean> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      const allEvents = await this.client.queryEvents({
        query: {
          MoveEventType: `${this.packageId}::points::PointsClaimed`,
        },
        limit: 50,
        order: "descending",
      });

      for (const ev of allEvents.data) {
        const data = ev.parsedJson as unknown as PointsClaimedEvent;
        if (this.normalizeAddress(data.wallet_address) === normalized) {
          console.log(
            `✅ hasClaimed → true (found event for ${walletAddress})`,
          );
          return true;
        }
      }

      console.log(
        `📝 No event found, running devInspect fallback for ${walletAddress}`,
      );
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::has_claimed`,
        arguments: [
          tx.object(this.pointsRegistryId),
          tx.pure.string(normalized),
        ],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: normalized,
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        return bytes[0] === 1;
      }

      return false;
    } catch (error) {
      console.error("Error in hasClaimed:", error);
      return false;
    }
  }

  // =========================================================================
  // READ: getBalance
  // =========================================================================
  async getBalance(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      const allEvents = await this.client.queryEvents({
        query: {
          MoveEventType: `${this.packageId}::points::PointsClaimed`,
        },
        limit: 50,
        order: "descending",
      });

      for (const ev of allEvents.data) {
        const data = ev.parsedJson as unknown as PointsClaimedEvent;
        if (this.normalizeAddress(data.wallet_address) === normalized) {
          const balance = Number(data.new_balance);
          console.log(
            `✅ getBalance → ${balance} (from event for ${walletAddress})`,
          );
          return balance;
        }
      }

      console.log(
        `📝 No event found, running devInspect fallback for balance of ${walletAddress}`,
      );
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_balance`,
        arguments: [
          tx.object(this.pointsRegistryId),
          tx.pure.string(normalized),
        ],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: normalized,
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        const view = new DataView(new Uint8Array(bytes).buffer);
        return Number(view.getBigUint64(0, true));
      }

      return 0;
    } catch (error) {
      console.error("Error in getBalance:", error);
      return 0;
    }
  }

  // =========================================================================
  // READ: getLastCheckin — NEW METHOD
  //
  // Returns timestamp (ms) of last check-in, or 0 if never checked in.
  // Uses event scan first (fast), falls back to devInspect.
  // =========================================================================
  async getLastCheckin(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      // Try events first
      const allEvents = await this.client.queryEvents({
        query: {
          MoveEventType: `${this.packageId}::points::CheckInCompleted`,
        },
        limit: 50,
        order: "descending",
      });

      for (const ev of allEvents.data) {
        const data = ev.parsedJson as unknown as CheckInCompletedEvent;
        if (this.normalizeAddress(data.wallet_address) === normalized) {
          const timestamp = Number(data.timestamp);
          console.log(
            `✅ getLastCheckin → ${timestamp} (from event for ${walletAddress})`,
          );
          return timestamp;
        }
      }

      // Fallback to devInspect
      console.log(
        `📝 No check-in event found, running devInspect for ${walletAddress}`,
      );
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_last_checkin`,
        arguments: [
          tx.object(this.pointsRegistryId),
          tx.pure.string(normalized),
        ],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: normalized,
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        const view = new DataView(new Uint8Array(bytes).buffer);
        return Number(view.getBigUint64(0, true));
      }

      return 0;
    } catch (error) {
      console.error("Error in getLastCheckin:", error);
      return 0;
    }
  }

  // =========================================================================
  // READ: canCheckin — NEW METHOD
  //
  // Returns true if user can check in now (cooldown passed or never checked in)
  // =========================================================================
  async canCheckin(walletAddress: string): Promise<boolean> {
    try {
      const lastCheckin = await this.getLastCheckin(walletAddress);

      if (lastCheckin === 0) {
        // Never checked in
        return true;
      }

      const now = Date.now();
      const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
      const timeSinceLast = now - lastCheckin;

      return timeSinceLast >= COOLDOWN_MS;
    } catch (error) {
      console.error("Error in canCheckin:", error);
      return false;
    }
  }

  // =========================================================================
  // READ: current blob ID from on-chain BlobRegistry
  // =========================================================================
  async getCurrentBlobId(): Promise<string | null> {
    try {
      const object = await this.client.getObject({
        id: this.blobRegistryId,
        options: {
          showContent: true,
        },
      });

      if (object.data?.content?.dataType === "moveObject") {
        const fields = (object.data.content as any).fields;
        let currentBlobId = fields?.current_blob_id;

        if (!currentBlobId) {
          console.log("⚠️  BlobRegistry is empty");
          return null;
        }

        if (typeof currentBlobId === "string") {
          currentBlobId = currentBlobId.trim();
        } else if (
          typeof currentBlobId === "object" &&
          currentBlobId !== null
        ) {
          const value =
            (currentBlobId as any).value || (currentBlobId as any).bytes;
          if (typeof value === "string") {
            currentBlobId = value.trim();
          } else if (Array.isArray(value)) {
            currentBlobId = new TextDecoder()
              .decode(new Uint8Array(value))
              .trim();
          }
        }

        currentBlobId = (currentBlobId as string)
          .replace(/[^\x20-\x7E]/g, "")
          .trim();

        if (!currentBlobId) {
          console.log("⚠️  BlobRegistry contains empty string");
          return null;
        }

        console.log(`📖 Read blob ID from BlobRegistry: "${currentBlobId}"`);
        return currentBlobId;
      }

      console.log("⚠️  BlobRegistry not found or invalid format");
      return null;
    } catch (error) {
      console.error("Error reading BlobRegistry:", error);
      return null;
    }
  }
}
