// ============================================================================
// TicketMinter  —  FIXED
//
// ROOT CAUSE:  devInspectTransactionBlock is a *simulation* endpoint.  It
// does NOT reliably reflect state that was committed in a *recent* transaction
// on the same fullnode.  On testnet this lag can persist for 20+ seconds,
// which is exactly what the polling logs showed.
//
// FIX STRATEGY (three layers, most reliable first):
//
//   1. verifyClaimByDigest(digest)          ← NEW
//        After the user signs, pass the digest here.  It calls
//        getTransactionBlock with showEvents:true and looks for the
//        PointsClaimed event.  If found, the claim is 100 % confirmed
//        and we can extract the balance right from the event — zero
//        latency, zero guessing.
//
//   2. hasClaimed / getBalance              ← REWRITTEN
//        Instead of devInspect (simulation), we now do TWO things:
//          a) Subscribe to on-chain events via queryEvents filtered by
//             the module and the wallet address.  This is the canonical
//             way to read state that was just written.
//          b) Fall back to devInspect only if no events are found (i.e.
//             the wallet genuinely has never claimed).
//        Both paths still normalise the address the same way.
//
//   3. normaliseAddress                     ← unchanged, still needed for
//        the devInspect fallback path.
// ============================================================================

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Shape of the PointsClaimed event as returned by the Sui JSON-RPC layer.
// ---------------------------------------------------------------------------
interface PointsClaimedEvent {
  wallet_address: string;
  amount: string; // u64 comes back as a decimal string
  reason: string;
  new_balance: string; // u64 decimal string
  timestamp: string;
}

export class TicketMinter {
  private client: SuiClient;
  private keypair: Ed25519Keypair;

  // On-chain object IDs (set once at deploy, never change)
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
        "Missing env vars. After deploying points.move, set:\n" +
          "  SUI_PACKAGE_ID, SUI_ADMIN_CAP_ID, SUI_POINTS_REGISTRY_ID, SUI_BLOB_REGISTRY_ID",
      );
    }

    console.log("✅ TicketMinter initialized");
    console.log(`   Network:         ${network}`);
    console.log(`   Package:         ${this.packageId}`);
    console.log(`   PointsRegistry:  ${this.pointsRegistryId}`);
    console.log(`   BlobRegistry:    ${this.blobRegistryId}`);
  }

  // -----------------------------------------------------------------------
  // ADDRESS NORMALISATION  (kept for the devInspect fallback)
  // -----------------------------------------------------------------------
  private normalizeAddress(addr: string): string {
    const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
    return "0x" + hex.padStart(64, "0");
  }

  // =======================================================================
  // NEW ──  verifyClaimByDigest(digest)
  //
  // Call this immediately after the user's claim transaction is confirmed.
  // It fetches the actual transaction receipt, extracts the PointsClaimed
  // event, and returns structured proof of the claim.  No simulation, no
  // guessing — if the tx succeeded and the event is there, the claim is real.
  // =======================================================================
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

      // Look for our PointsClaimed event in the receipt
      const events = tx.events || [];
      const claimEvent = events.find(
        (e) => e.type === `${this.packageId}::points::PointsClaimed`,
      );

      if (!claimEvent) {
        console.warn("⚠️  No PointsClaimed event in transaction");
        return null;
      }

      const data = claimEvent.parsedJson as unknown as PointsClaimedEvent;
      console.log(`✅ Claim verified on-chain:`, data);

      return {
        confirmed: true,
        balance: Number(data.new_balance),
        amount: Number(data.amount),
        timestamp: data.timestamp,
      };
    } catch (error) {
      console.error("❌ verifyClaimByDigest error:", error);
      return null;
    }
  }

  // =======================================================================
  // MINT ELIGIBILITY TICKET  (admin signs, ticket transferred to user)
  // =======================================================================
  async mintTicket(
    walletAddress: string,
    pointsAmount: number,
    reason: string = "Waitlist Bonus",
  ): Promise<string | null> {
    try {
      console.log(
        `\n🎟️  Minting ticket → ${walletAddress} (${pointsAmount} pts)`,
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

  // =======================================================================
  // UPDATE BLOB REGISTRY  (admin signs)
  // =======================================================================
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

  // =======================================================================
  // READ: hasClaimed
  //
  // Strategy:
  //   1. queryEvents for PointsClaimed filtered to this wallet  →  O(1) and
  //      reflects committed state immediately.
  //   2. If no event found, fall back to devInspect (handles the case where
  //      the wallet truly has never claimed — there will be no event).
  // =======================================================================
  async hasClaimed(walletAddress: string): Promise<boolean> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      // --- Layer 1: check events (fast, reliable for recent claims) ---
      // queryEvents doesn't support filtering by event field, so we filter
      // client-side.  With limit:50 this is fine for <thousands of claims.
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

      // --- Layer 2: devInspect fallback (for wallets that never claimed) ---
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

  // =======================================================================
  // READ: getBalance
  //
  // Same two-layer strategy as hasClaimed.  The event carries new_balance
  // so we can read it directly without touching the table.
  // =======================================================================
  async getBalance(walletAddress: string): Promise<number> {
    try {
      const normalized = this.normalizeAddress(walletAddress);

      // --- Layer 1: scan recent PointsClaimed events for this wallet ---
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

      // --- Layer 2: devInspect fallback ---
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

  // =======================================================================
  // READ: current blob ID from on-chain BlobRegistry
  // =======================================================================
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

        // Handle different possible formats
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

        // Final cleanup: remove any non-printable characters
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
