// UPDATED VERSION with sponsored waitlist claims

import { EventId, SuiClient, getFullnodeUrl } from "@mysten/sui/client";
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
  checkin_date: string;
  current_streak: string;
  is_milestone: boolean;
  milestone_bonus: string;
}

interface TaskPointsClaimedEvent {
  wallet_address: string;
  points_earned: string;
  new_balance: string;
  task_count: string;
  timestamp: string;
}

export class TicketMinter {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;
  private adminCapId: string;
  private pointsRegistryId: string;
  private blobRegistryId: string;
  private feeConfigId: string;

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
    this.feeConfigId = process.env.SUI_FEE_CONFIG_ID || "";

    if (
      !this.packageId ||
      !this.adminCapId ||
      !this.pointsRegistryId ||
      !this.blobRegistryId ||
      !this.feeConfigId
    ) {
      throw new Error(
        "Missing env vars. Set: SUI_PACKAGE_ID, SUI_ADMIN_CAP_ID, " +
        "SUI_POINTS_REGISTRY_ID, SUI_BLOB_REGISTRY_ID, SUI_FEE_CONFIG_ID",
      );
    }

    console.log("✅ TicketMinter initialized");
    console.log(`   Network:         ${network}`);
    console.log(`   Package:         ${this.packageId}`);
    console.log(`   PointsRegistry:  ${this.pointsRegistryId}`);
    console.log(`   BlobRegistry:    ${this.blobRegistryId}`);
    console.log(`   FeeConfig:       ${this.feeConfigId}`);
  }

  private normalizeAddress(addr: string): string {
    const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
    return "0x" + hex.padStart(64, "0");
  }

  private toMoveAddressFormat(addr: string): string {
    const normalized = this.normalizeAddress(addr);
    const withoutPrefix = normalized.slice(2);
    const withoutLeadingZeros = withoutPrefix.replace(/^0+/, "") || "0";
    return "0x" + withoutLeadingZeros;
  }

  async getCheckinFee(): Promise<number> {
    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_checkin_fee`,
        arguments: [tx.object(this.feeConfigId)],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: this.keypair.toSuiAddress(),
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        const view = new DataView(new Uint8Array(bytes).buffer);
        const fee = Number(view.getBigUint64(0, true));
        console.log(
          `📊 Current check-in fee: ${fee} MIST (${(fee / 1_000_000_000).toFixed(3)} SUI)`,
        );
        return fee;
      }

      console.warn("⚠️  Could not read fee, using default");
      return 2_000_000;
    } catch (error) {
      console.error("❌ Error in getCheckinFee:", error);
      return 2_000_000;
    }
  }

  async updateCheckinFee(newFee: number): Promise<string | null> {
    try {
      console.log(
        `\n💰 Updating check-in fee → ${newFee} MIST (${(newFee / 1_000_000_000).toFixed(3)} SUI)`,
      );

      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::update_checkin_fee`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.feeConfigId),
          tx.pure.u64(newFee),
          tx.object("0x6"),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === "success") {
        console.log(`✅ Fee updated  tx=${result.digest}`);
        return result.digest;
      }

      console.error("❌ Fee update failed:", result.effects?.status?.error);
      return null;
    } catch (error) {
      console.error("❌ updateCheckinFee error:", error);
      throw error;
    }
  }

  async setFeeTreasury(treasuryAddress: string): Promise<string | null> {
    try {
      console.log(`\n🏦 Setting fee treasury → ${treasuryAddress}`);

      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::set_fee_treasury`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.feeConfigId),
          tx.pure.address(treasuryAddress),
          tx.object("0x6"),
        ],
      });

      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: { showEffects: true },
      });

      if (result.effects?.status?.status === "success") {
        console.log(`✅ Treasury set  tx=${result.digest}`);
        return result.digest;
      }

      console.error("❌ Treasury set failed:", result.effects?.status?.error);
      return null;
    } catch (error) {
      console.error("❌ setFeeTreasury error:", error);
      throw error;
    }
  }

  async getFeeTreasury(): Promise<string | null> {
    try {
      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::points::get_fee_treasury`,
        arguments: [tx.object(this.feeConfigId)],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: this.keypair.toSuiAddress(),
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        const address = "0x" + Buffer.from(bytes).toString("hex");
        return address;
      }

      return null;
    } catch (error) {
      console.error("❌ Error in getFeeTreasury:", error);
      return null;
    }
  }

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

      const taskClaimEvent = events.find(
        (e) => e.type === `${this.packageId}::task_points::TaskPointsClaimed`,
      );

      if (taskClaimEvent) {
        const data =
          taskClaimEvent.parsedJson as unknown as TaskPointsClaimedEvent;
        console.log(`✅ Task claim verified on-chain:`, data);
        return {
          confirmed: true,
          balance: Number(data.new_balance),
          amount: Number(data.points_earned),
          timestamp: data.timestamp,
        };
      }

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

  async mintCheckinTicket(
    walletAddress: string,
    pointsAmount: number,
    checkinDate: string,
  ): Promise<string | null> {
    try {
      console.log(
        `\n🎟️  Minting check-in ticket → ${walletAddress} for ${checkinDate} (${pointsAmount} pts)`,
      );

      const tx = new Transaction();
      const dateBytes = Array.from(new TextEncoder().encode(checkinDate));

      tx.moveCall({
        target: `${this.packageId}::points::mint_checkin_ticket`,
        arguments: [
          tx.object(this.adminCapId),
          tx.pure.address(walletAddress),
          tx.pure.u64(pointsAmount),
          tx.pure.vector("u8", dateBytes),
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
        console.error(
          "❌ Check-in ticket mint failed:",
          result.effects?.status?.error,
        );
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

        console.log(
          `✅ Check-in ticket minted: ${ticketId}  tx=${result.digest}`,
        );
        return ticketId;
      }

      console.warn("⚠️  Tx succeeded but no created object found");
      return null;
    } catch (error) {
      console.error("❌ mintCheckinTicket error:", error);
      throw error;
    }
  }

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
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      tx.moveCall({
        target: `${this.packageId}::points::has_claimed`,
        arguments: [tx.object(this.pointsRegistryId), tx.pure.string(moveAddr)],
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

  async getBalance(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      const [claimEvents, taskClaimEvents] = await Promise.all([
        this.client.queryEvents({
          query: { MoveEventType: `${this.packageId}::points::PointsClaimed` },
          limit: 50,
          order: "descending",
        }),
        this.client.queryEvents({
          query: {
            MoveEventType: `${this.packageId}::task_points::TaskPointsClaimed`,
          },
          limit: 50,
          order: "descending",
        }),
      ]);

      interface BalanceSnapshot {
        balance: number;
        timestamp: number;
      }
      const snapshots: BalanceSnapshot[] = [];

      for (const ev of claimEvents.data) {
        const data = ev.parsedJson as unknown as PointsClaimedEvent;
        if (this.normalizeAddress(data.wallet_address) === normalized) {
          snapshots.push({
            balance: Number(data.new_balance),
            timestamp: Number(data.timestamp),
          });
        }
      }

      for (const ev of taskClaimEvents.data) {
        const data = ev.parsedJson as unknown as TaskPointsClaimedEvent;
        if (this.normalizeAddress(data.wallet_address) === normalized) {
          snapshots.push({
            balance: Number(data.new_balance),
            timestamp: Number(data.timestamp),
          });
        }
      }

      if (snapshots.length > 0) {
        snapshots.sort((a: BalanceSnapshot, b: BalanceSnapshot) => b.timestamp - a.timestamp);
        const latestBalance = snapshots[0].balance;
        console.log(
          `✅ getBalance → ${latestBalance} (most recent of ${snapshots.length} events for ${walletAddress.substring(0, 10)}...)`,
        );
        return latestBalance;
      }

      console.log(
        `📝 No events found, running devInspect fallback for balance of ${walletAddress}`,
      );
      const tx = new Transaction();
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      tx.moveCall({
        target: `${this.packageId}::points::get_balance`,
        arguments: [tx.object(this.pointsRegistryId), tx.pure.string(moveAddr)],
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

  async getLastCheckin(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

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

      console.log(
        `📝 No check-in event found, running devInspect for ${walletAddress}`,
      );
      const tx = new Transaction();
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      tx.moveCall({
        target: `${this.packageId}::points::get_last_checkin`,
        arguments: [tx.object(this.pointsRegistryId), tx.pure.string(moveAddr)],
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

  async getLastCheckinDate(walletAddress: string): Promise<string> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

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
          console.log(
            `✅ getLastCheckinDate → ${data.checkin_date} (from event for ${walletAddress})`,
          );
          return data.checkin_date;
        }
      }

      console.log(
        `📝 No check-in event found, running devInspect for date of ${walletAddress}`,
      );
      const tx = new Transaction();
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      tx.moveCall({
        target: `${this.packageId}::points::get_last_checkin_date`,
        arguments: [tx.object(this.pointsRegistryId), tx.pure.string(moveAddr)],
      });

      const result = await this.client.devInspectTransactionBlock({
        sender: normalized,
        transactionBlock: tx,
      });

      if (result.results?.[0]?.returnValues?.[0]) {
        const [bytes] = result.results[0].returnValues[0];
        const dateStr = new TextDecoder().decode(new Uint8Array(bytes));
        return dateStr.trim();
      }

      return "";
    } catch (error) {
      console.error("Error in getLastCheckinDate:", error);
      return "";
    }
  }

  async getCurrentStreak(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

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
          const streak = Number(data.current_streak);
          console.log(
            `✅ getCurrentStreak → ${streak} (from event for ${walletAddress})`,
          );
          return streak;
        }
      }

      console.log(
        `📝 No check-in event found, running devInspect for streak of ${walletAddress}`,
      );
      const tx = new Transaction();
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      tx.moveCall({
        target: `${this.packageId}::points::get_current_streak`,
        arguments: [tx.object(this.pointsRegistryId), tx.pure.string(moveAddr)],
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
      console.error("Error in getCurrentStreak:", error);
      return 0;
    }
  }

  async getTotalCheckins(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);
      const moveAddr = this.toMoveAddressFormat(walletAddress);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${this.packageId}::points::get_total_checkins`,
          arguments: [
            tx.object(this.pointsRegistryId),
            tx.pure.string(moveAddr),
          ],
        });

        const result = await this.client.devInspectTransactionBlock({
          sender: normalized,
          transactionBlock: tx,
        });

        if (result.results?.[0]?.returnValues?.[0]) {
          const [bytes] = result.results[0].returnValues[0];
          const view = new DataView(new Uint8Array(bytes).buffer);
          const total = Number(view.getBigUint64(0, true));

          if (total > 0) {
            console.log(
              `✅ getTotalCheckins (contract) → ${total} for ${walletAddress.substring(0, 10)}...`,
            );
            return total;
          }

          console.log(
            `📝 Contract returned 0, falling back to event counting for ${walletAddress.substring(0, 10)}...`,
          );
        }
      } catch (contractError) {
        console.warn(
          `⚠️  Contract call failed for getTotalCheckins:`,
          contractError,
        );
      }

      try {
        console.log(
          `📊 Counting check-in events for ${walletAddress.substring(0, 10)}...`,
        );

        let count = 0;
        let cursor: EventId | null = null;
        let hasMore = true;
        let pagesChecked = 0;
        const MAX_PAGES = 100;

        while (hasMore && pagesChecked < MAX_PAGES) {
          const eventsPage = await this.client.queryEvents({
            query: {
              MoveEventType: `${this.packageId}::points::CheckInCompleted`,
            },
            limit: 50,
            order: "descending",
            cursor: cursor || undefined,
          });

          for (const ev of eventsPage.data) {
            const data = ev.parsedJson as unknown as CheckInCompletedEvent;
            if (this.normalizeAddress(data.wallet_address) === normalized) {
              count++;
            }
          }

          pagesChecked++;

          if (eventsPage.hasNextPage && eventsPage.nextCursor) {
            cursor = eventsPage.nextCursor;
          } else {
            hasMore = false;
          }
        }

        if (count > 0) {
          console.log(
            `✅ getTotalCheckins (events) → ${count} for ${walletAddress.substring(0, 10)}... (checked ${pagesChecked} pages)`,
          );
          return count;
        }

        console.log(
          `⚠️  No check-in events found after checking ${pagesChecked} pages`,
        );
      } catch (eventError) {
        console.warn(
          `⚠️  Event counting failed for getTotalCheckins:`,
          eventError,
        );
      }

      try {
        const streak = await this.getCurrentStreak(walletAddress);
        if (streak > 0) {
          console.log(
            `⚠️  Using streak (${streak}) as total_checkins estimate for ${walletAddress.substring(0, 10)}...`,
          );
          return streak;
        }
      } catch (streakError) {
        console.warn(`⚠️  Streak fallback failed:`, streakError);
      }

      console.log(
        `📝 No check-ins found for ${walletAddress.substring(0, 10)}...`,
      );
      return 0;
    } catch (error) {
      console.error("Error in getTotalCheckins:", error);
      return 0;
    }
  }

  async getCurrentBlobId(): Promise<string | null> {
    try {
      const object = await this.client.getObject({
        id: this.blobRegistryId,
        options: { showContent: true },
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
      throw error;
    }
  }

  async mintTaskClaimTicket(
    walletAddress: string,
    taskCount: number,
  ): Promise<string | null> {
    try {
      console.log(
        `\n🎟️  Minting task claim ticket → ${walletAddress} (${taskCount} tasks)`,
      );

      const tx = new Transaction();

      tx.moveCall({
        target: `${this.packageId}::task_points::mint_task_claim_ticket`,
        arguments: [
          tx.object(this.adminCapId),
          tx.pure.address(walletAddress),
          tx.pure.u64(taskCount),
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
        console.error(
          "❌ Task claim ticket mint failed:",
          result.effects?.status?.error,
        );
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

        console.log(
          `✅ Task claim ticket minted: ${ticketId}  tx=${result.digest}`,
        );
        return ticketId;
      }

      console.warn("⚠️  Tx succeeded but no created object found");
      return null;
    } catch (error) {
      console.error("❌ mintTaskClaimTicket error:", error);
      throw error;
    }
  }

  // NEW: Sponsored claim - mint ticket and claim in single transaction
  async sponsoredClaimWaitlistPoints(walletAddress: string): Promise<{
    success: boolean;
    digest?: string;
    balance?: number;
    error?: string;
  }> {
    try {
      console.log(
        `\n💰 [SPONSORED] Claiming waitlist points for: ${walletAddress}`,
      );

      const tx = new Transaction();
      tx.setGasBudget(10_000_000);

      tx.moveCall({
        target: `${this.packageId}::points::sponsored_claim_waitlist_points`,
        arguments: [
          tx.object(this.adminCapId),
          tx.object(this.pointsRegistryId),
          tx.pure.address(walletAddress),
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
        console.error(
          "❌ Sponsored claim failed:",
          result.effects?.status?.error,
        );
        return {
          success: false,
          error: result.effects?.status?.error || "Transaction failed",
        };
      }

      console.log(`✅ Sponsored claim successful  tx=${result.digest}`);

      const events = result.events || [];
      const claimEvent = events.find(
        (e) => e.type === `${this.packageId}::points::PointsClaimed`,
      );

      let balance = 0;
      if (claimEvent) {
        const data = claimEvent.parsedJson as unknown as PointsClaimedEvent;
        balance = Number(data.new_balance);
        console.log(`   User balance: ${balance} points`);
      }

      return {
        success: true,
        digest: result.digest,
        balance,
      };
    } catch (error: any) {
      console.error("❌ sponsoredClaimWaitlistPoints error:", error);
      return {
        success: false,
        error: error?.message || "Unknown error occurred",
      };
    }
  }
}
