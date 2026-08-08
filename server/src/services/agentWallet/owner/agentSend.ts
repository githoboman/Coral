import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient, assetTypeFor, decimalsFor } from "../config.js";
import { getAgentExecutor } from "../executor.js";
import type { AgentWalletRecord } from "../types.js";

/**
 * Agent-signed transfer of SUI or a token OUT of the agent wallet to any address.
 * Powers the "Send" action on the Agent Wallet card. This moves the agent's OWN
 * on-chain balance (not its DeepBook BalanceManager); the agent key signs it
 * server-side. Amounts are whole tokens (e.g. 0.5 SUI). SUI transfers split from
 * the gas coin; other coins are merged then split.
 */
export interface AgentSendResult {
  ok: boolean;
  digest?: string;
  reason?: string;
}

const SUI_TYPE = "0x2::sui::SUI";

export async function agentSend(
  wallet: AgentWalletRecord,
  recipient: string,
  symbol: string,
  amountWhole: number,
): Promise<AgentSendResult> {
  if (!recipient?.startsWith("0x") || recipient.length < 10) {
    return { ok: false, reason: "Invalid recipient address" };
  }
  if (!(amountWhole > 0)) return { ok: false, reason: "Amount must be greater than zero" };

  let coinType: string;
  try {
    coinType = assetTypeFor(symbol);
  } catch {
    return { ok: false, reason: `Unknown token '${symbol}'` };
  }

  const base = BigInt(Math.round(amountWhole * 10 ** decimalsFor(symbol)));
  const tx = new Transaction();

  try {
    if (coinType === SUI_TYPE) {
      // SUI: split the amount off the gas coin and send it.
      const [coin] = tx.splitCoins(tx.gas, [base]);
      tx.transferObjects([coin], tx.pure.address(recipient));
    } else {
      // Other tokens: gather the agent's coins of this type, merge, split, send.
      const { data: coins } = await getSuiClient().getCoins({ owner: wallet.agentAddress, coinType });
      if (!coins.length) return { ok: false, reason: `Agent holds no ${symbol}` };
      const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
      if (total < base) {
        return { ok: false, reason: `Insufficient ${symbol}: has ${Number(total) / 10 ** decimalsFor(symbol)}, needs ${amountWhole}` };
      }
      const primary = tx.object(coins[0].coinObjectId);
      if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map((c) => tx.object(c.coinObjectId)));
      const [coin] = tx.splitCoins(primary, [base]);
      tx.transferObjects([coin], tx.pure.address(recipient));
    }

    const result = await getAgentExecutor().execute(wallet, tx);
    if (!result.success) return { ok: false, reason: result.error };
    return { ok: true, digest: result.digest };
  } catch (err: any) {
    return { ok: false, reason: err?.message || String(err) };
  }
}
