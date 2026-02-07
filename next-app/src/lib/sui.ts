import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

// Config from env
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet' | 'devnet';
const PACKAGE_ID = process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '';
const POINTS_REGISTRY_ID = process.env.NEXT_PUBLIC_SUI_POINTS_REGISTRY_ID || '';
const BLOB_REGISTRY_ID = process.env.SUI_BLOB_REGISTRY_ID || '';

// Singleton client
let suiClient: SuiJsonRpcClient | null = null;

export function getSuiClient(): SuiJsonRpcClient {
  if (!suiClient) {
    suiClient = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(SUI_NETWORK),
      network: SUI_NETWORK,
    });
  }
  return suiClient;
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, '0x');
}

interface PointsClaimedEvent {
  wallet_address: string;
  amount: string;
  reason: string;
  new_balance: string;
  timestamp: string;
}

/**
 * Get user's points balance from on-chain events
 */
export async function getBalance(walletAddress: string): Promise<number> {
  const client = getSuiClient();

  try {
    const normalized = normalizeAddress(walletAddress);

    // Query PointsClaimed events
    const allEvents = await client.queryEvents({
      query: {
        MoveEventType: `${PACKAGE_ID}::points::PointsClaimed`,
      },
      limit: 50,
      order: 'descending',
    });

    for (const ev of allEvents.data) {
      const data = ev.parsedJson as unknown as PointsClaimedEvent;
      if (normalizeAddress(data.wallet_address) === normalized) {
        return Number(data.new_balance);
      }
    }

    // Fallback: devInspect call
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::points::get_balance`,
      arguments: [
        tx.object(POINTS_REGISTRY_ID),
        tx.pure.string(normalized),
      ],
    });

    const result = await client.devInspectTransactionBlock({
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
    console.error('[Sui] Error getting balance:', error);
    return 0;
  }
}

/**
 * Check if a wallet has already claimed their bonus
 */
export async function hasClaimed(walletAddress: string): Promise<boolean> {
  const client = getSuiClient();

  try {
    const normalized = normalizeAddress(walletAddress);

    // Query PointsClaimed events
    const allEvents = await client.queryEvents({
      query: {
        MoveEventType: `${PACKAGE_ID}::points::PointsClaimed`,
      },
      limit: 50,
      order: 'descending',
    });

    for (const ev of allEvents.data) {
      const data = ev.parsedJson as unknown as PointsClaimedEvent;
      if (normalizeAddress(data.wallet_address) === normalized) {
        return true;
      }
    }

    // Fallback: devInspect call
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::points::get_balance`,
      arguments: [
        tx.object(POINTS_REGISTRY_ID),
        tx.pure.string(normalized),
      ],
    });

    const result = await client.devInspectTransactionBlock({
      sender: normalized,
      transactionBlock: tx,
    });

    if (result.results?.[0]?.returnValues?.[0]) {
      const [bytes] = result.results[0].returnValues[0];
      return bytes[0] === 1;
    }

    return false;
  } catch (error) {
    console.error('[Sui] Error checking if claimed:', error);
    return false;
  }
}

/**
 * Get current blob ID from on-chain BlobRegistry
 */
export async function getCurrentBlobId(): Promise<string | null> {
  const client = getSuiClient();

  if (!BLOB_REGISTRY_ID) {
    console.warn('[Sui] BLOB_REGISTRY_ID not configured');
    return null;
  }

  try {
    const object = await client.getObject({
      id: BLOB_REGISTRY_ID,
      options: { showContent: true },
    });

    if (object.data?.content?.dataType === 'moveObject') {
      const fields = (object.data.content as { fields?: Record<string, unknown> }).fields;
      const rawBlobId = fields?.current_blob_id;

      if (!rawBlobId) {
        return null;
      }

      let blobIdStr: string;

      // Handle different formats
      if (typeof rawBlobId === 'string') {
        blobIdStr = rawBlobId.trim();
      } else if (typeof rawBlobId === 'object' && rawBlobId !== null) {
        const objValue = rawBlobId as { value?: string; bytes?: number[] };
        const value = objValue.value || objValue.bytes;
        if (typeof value === 'string') {
          blobIdStr = value.trim();
        } else if (Array.isArray(value)) {
          blobIdStr = new TextDecoder().decode(new Uint8Array(value)).trim();
        } else {
          return null;
        }
      } else {
        return null;
      }

      // Clean non-printable characters
      blobIdStr = blobIdStr.replace(/[^\x20-\x7E]/g, '').trim();

      return blobIdStr || null;
    }

    return null;
  } catch (error) {
    console.error('[Sui] Error reading BlobRegistry:', error);
    return null;
  }
}
