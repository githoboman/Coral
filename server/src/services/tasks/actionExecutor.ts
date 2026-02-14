import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
// Define types locally since agents directory was removed
export interface TokenTransferParams {
  recipientAddress: string;
  amount: string;
  coinType: string;
}

export interface DCAParams {
  fromCoin: string;
  toCoin: string;
  amountPerPurchase: string;
  frequency: string; // cron expression
  duration?: number; // minutes
  totalAmountLimit?: string;
}

export type TaskActionType = 'transfer' | 'swap' | 'dca' | 'stake' | 'claim';

// Initialize Sui client - defaults to mainnet
const suiClient = new SuiClient({
  url: process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443',
});

export interface BuildTransactionResult {
  success: boolean;
  serializedTx?: string;
  error?: string;
  estimatedGas?: string;
}

export interface ActionStatusResult {
  success: boolean;
  status: 'pending' | 'success' | 'failure';
  txDigest?: string;
  error?: string;
  timestamp?: string;
}

/**
 * ActionExecutor builds unsigned Programmable Transaction Blocks (PTBs)
 * for Web3 task actions. The transactions are returned serialized and
 * must be signed by the user's wallet on the frontend.
 */
export class ActionExecutor {
  private client: SuiClient;

  constructor() {
    this.client = suiClient;
  }

  /**
   * Build an unsigned token transfer transaction
   */
  async buildTransferTransaction(
    params: TokenTransferParams,
    senderAddress: string
  ): Promise<BuildTransactionResult> {
    try {
      const tx = new Transaction();
      tx.setSender(senderAddress);

      // Get all coins of the specified type owned by sender
      const coins = await this.client.getCoins({
        owner: senderAddress,
        coinType: params.coinType,
      });

      if (!coins.data || coins.data.length === 0) {
        return {
          success: false,
          error: `No ${params.coinType} coins found in wallet`,
        };
      }

      const amountBigInt = BigInt(params.amount);

      // Check if user has enough balance
      const totalBalance = coins.data.reduce(
        (acc, coin) => acc + BigInt(coin.balance),
        BigInt(0)
      );

      if (totalBalance < amountBigInt) {
        return {
          success: false,
          error: `Insufficient balance. Have ${totalBalance.toString()}, need ${params.amount}`,
        };
      }

      // For SUI coin, use splitCoins from gas
      if (params.coinType === '0x2::sui::SUI') {
        const [coin] = tx.splitCoins(tx.gas, [amountBigInt]);
        tx.transferObjects([coin], params.recipientAddress);
      } else {
        // For other coins, merge all coins first, then split
        const primaryCoin = coins.data[0];
        const otherCoins = coins.data.slice(1);

        if (otherCoins.length > 0) {
          tx.mergeCoins(
            tx.object(primaryCoin.coinObjectId),
            otherCoins.map((c) => tx.object(c.coinObjectId))
          );
        }

        const [splitCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [
          amountBigInt,
        ]);
        tx.transferObjects([splitCoin], params.recipientAddress);
      }

      // Build and serialize the transaction
      const serialized = await tx.build({ client: this.client });

      return {
        success: true,
        serializedTx: Buffer.from(serialized).toString('base64'),
      };
    } catch (error) {
      console.error('Error building transfer transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build transaction',
      };
    }
  }

  /**
   * Build a DCA purchase transaction
   * Note: This is a single purchase - the scheduler handles recurring logic
   * For MVP, we do a simple SUI -> target token swap via DEX
   */
  async buildDCATransaction(
    params: DCAParams,
    senderAddress: string
  ): Promise<BuildTransactionResult> {
    try {
      // For MVP, DCA will create a placeholder that triggers manual execution
      // Full DEX integration would require Aftermath/Cetus SDK

      // For now, return an error asking for manual execution guidance
      // This can be expanded with actual DEX integration later

      return {
        success: false,
        error: 'DCA swap transactions require DEX integration. For MVP, please use token transfers. DEX integration coming soon.',
      };

      // TODO: Implement DEX swap logic using Aftermath or Cetus SDK
      // Example structure:
      // const tx = new Transaction();
      // tx.setSender(senderAddress);
      // const swapResult = await dexRouter.createSwapTx(tx, {
      //   fromCoin: params.fromCoin,
      //   toCoin: params.toCoin,
      //   amount: params.amountPerPurchase,
      //   slippage: 0.5, // 0.5%
      // });
      // const serialized = await tx.build({ client: this.client });
      // return { success: true, serializedTx: Buffer.from(serialized).toString('base64') };
    } catch (error) {
      console.error('Error building DCA transaction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build DCA transaction',
      };
    }
  }

  /**
   * Get the status of a submitted transaction
   */
  async getTransactionStatus(txDigest: string): Promise<ActionStatusResult> {
    try {
      const result = await this.client.getTransactionBlock({
        digest: txDigest,
        options: {
          showEffects: true,
        },
      });

      const status = result.effects?.status?.status;

      return {
        success: true,
        status: status === 'success' ? 'success' : 'failure',
        txDigest,
        timestamp: result.timestampMs?.toString(),
        error: status !== 'success' ? result.effects?.status?.error : undefined,
      };
    } catch (error) {
      console.error('Error getting transaction status:', error);
      return {
        success: false,
        status: 'pending',
        error: error instanceof Error ? error.message : 'Failed to get transaction status',
      };
    }
  }

  /**
   * Validate a wallet address
   */
  isValidSuiAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(address);
  }

  /**
   * Get the current SUI balance for an address
   */
  async getSuiBalance(address: string): Promise<string> {
    try {
      const balance = await this.client.getBalance({
        owner: address,
        coinType: '0x2::sui::SUI',
      });
      return balance.totalBalance;
    } catch (error) {
      console.error('Error getting SUI balance:', error);
      return '0';
    }
  }
}

// Export singleton instance
export const actionExecutor = new ActionExecutor();
