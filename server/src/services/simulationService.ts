// server/src/services/simulationService.ts
// Phase 4: Safe transaction simulation engine with dry-run + safeguards

import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { getSupabaseClient } from "../config/supabase";
import { getBlockVisionService } from "./blockVisionService";
import { getUserStateService } from "./userStateService";

// ======================================================================
// TYPES
// ======================================================================

export type SimulationType = "transfer" | "swap" | "stake";

export interface SimulationResult {
  type: SimulationType;
  success: boolean;
  narrative: string;
  estimatedGas: string;   // in SUI (human-readable)
  warnings: string[];
  serializedTx?: string;  // base64, ready for wallet sign
  details: Record<string, any>;
}

export interface SimulationLog {
  id: number;
  wallet_address: string;
  simulation_type: SimulationType;
  input_params: Record<string, any>;
  result: Record<string, any>;
  warnings: string[];
  executed: boolean;
  execution_tx_digest: string | null;
  created_at: string;
}

// ======================================================================
// CONSTANTS
// ======================================================================

const SUI_DECIMALS = 9;
const MIST_PER_SUI = 1_000_000_000;
const GAS_BUFFER_SUI = 0.1;             // warn if < 0.1 SUI left after tx
const LOW_BALANCE_THRESHOLD_SUI = 1;     // warn if total < 1 SUI after tx
const DEFAULT_SLIPPAGE_PCT = 2;          // 2% default slippage estimate
const HIGH_SLIPPAGE_PCT_MODERATE = 3;    // warn threshold for moderate risk
const HIGH_SLIPPAGE_PCT_CONSERVATIVE = 2;

// ======================================================================
// SERVICE
// ======================================================================

export class SimulationService {
  private client: SuiClient;
  private supabase = getSupabaseClient();
  private blockVision = getBlockVisionService();

  constructor() {
    this.client = new SuiClient({
      url: process.env.SUI_RPC_URL || "https://fullnode.mainnet.sui.io:443",
    });
  }

  // ── Transfer Simulation ───────────────────────────────────────────

  /**
   * Simulates a SUI or token transfer using Sui SDK dry-run.
   * Returns gas estimate, balance impact, and warnings.
   */
  async simulateTransfer(
    sender: string,
    recipient: string,
    amount: string,
    coinType: string = "0x2::sui::SUI"
  ): Promise<SimulationResult> {
    const inputParams = { sender, recipient, amount, coinType };
    const warnings: string[] = [];

    try {
      // Validate addresses
      if (!this.isValidAddress(sender) || !this.isValidAddress(recipient)) {
        return this.failResult("transfer", "Invalid sender or recipient address.", inputParams);
      }

      if (sender === recipient) {
        warnings.push("Sender and recipient are the same address.");
      }

      const amountMist = BigInt(Math.floor(parseFloat(amount) * MIST_PER_SUI));

      // Build the PTB
      const tx = new Transaction();
      tx.setSender(sender);

      if (coinType === "0x2::sui::SUI") {
        const [coin] = tx.splitCoins(tx.gas, [amountMist]);
        tx.transferObjects([coin], recipient);
      } else {
        // For non-SUI tokens, fetch coins
        const coins = await this.client.getCoins({ owner: sender, coinType });
        if (!coins.data?.length) {
          return this.failResult("transfer", `No ${coinType} tokens found in wallet.`, inputParams);
        }

        const primaryCoin = coins.data[0];
        if (coins.data.length > 1) {
          tx.mergeCoins(
            tx.object(primaryCoin.coinObjectId),
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId))
          );
        }
        const [splitCoin] = tx.splitCoins(tx.object(primaryCoin.coinObjectId), [amountMist]);
        tx.transferObjects([splitCoin], recipient);
      }

      // Dry-run
      const serialized = await tx.build({ client: this.client });
      const dryRun = await this.client.dryRunTransactionBlock({
        transactionBlock: Buffer.from(serialized).toString("base64"),
      });

      const gasUsed = dryRun.effects?.gasUsed;
      const totalGasMist =
        BigInt(gasUsed?.computationCost || "0") +
        BigInt(gasUsed?.storageCost || "0") -
        BigInt(gasUsed?.storageRebate || "0");
      const gasSui = Number(totalGasMist) / MIST_PER_SUI;

      // Balance checks
      const balanceWarnings = await this.checkBalanceWarnings(
        sender, parseFloat(amount), gasSui, coinType
      );
      warnings.push(...balanceWarnings);

      const status = dryRun.effects?.status?.status;
      if (status !== "success") {
        return this.failResult(
          "transfer",
          `Dry-run failed: ${dryRun.effects?.status?.error || "Unknown error"}`,
          inputParams,
          warnings
        );
      }

      const narrative =
        `Simulated: Transfer ${amount} ${coinType === "0x2::sui::SUI" ? "SUI" : coinType.split("::").pop()} ` +
        `to ${recipient.slice(0, 8)}...${recipient.slice(-4)}. ` +
        `Estimated gas: ${gasSui.toFixed(6)} SUI.`;

      const result: SimulationResult = {
        type: "transfer",
        success: true,
        narrative,
        estimatedGas: gasSui.toFixed(6),
        warnings,
        serializedTx: Buffer.from(serialized).toString("base64"),
        details: {
          amount,
          coinType,
          recipient,
          gasBreakdown: {
            computation: gasUsed?.computationCost,
            storage: gasUsed?.storageCost,
            rebate: gasUsed?.storageRebate,
          },
        },
      };

      await this.logSimulation(sender, result, inputParams);
      return result;
    } catch (err: any) {
      console.error(`[Simulation] Transfer simulation failed:`, err?.message);
      return this.failResult("transfer", `Simulation error: ${err?.message}`, inputParams, warnings);
    }
  }

  // ── Swap Estimation ───────────────────────────────────────────────

  /**
   * Estimates a token swap outcome using price data.
   * Does NOT build a real DEX PTB -- uses price estimation instead.
   */
  async simulateSwap(
    sender: string,
    fromCoin: string,
    toCoin: string,
    amount: string
  ): Promise<SimulationResult> {
    const inputParams = { sender, fromCoin, toCoin, amount };
    const warnings: string[] = [];

    try {
      // Fetch portfolio for price data
      const portfolio = await this.blockVision.getAccountPortfolio(sender);
      const fromToken = portfolio.coins.find(
        (c) => c.symbol.toUpperCase() === fromCoin.toUpperCase() ||
          c.coinType === fromCoin
      );

      if (!fromToken) {
        return this.failResult("swap", `${fromCoin} not found in your wallet.`, inputParams);
      }

      const fromPrice = fromToken.price || 0;
      const fromValueUsd = parseFloat(amount) * fromPrice;

      // Check balance — reject swaps larger than the wallet holds.
      const availableBalance = parseFloat(fromToken.balance);
      if (parseFloat(amount) > availableBalance) {
        return this.failResult(
          "swap",
          `Insufficient balance: you have ${availableBalance} ${fromToken.symbol}, but you're trying to swap ${amount}.`,
          inputParams
        );
      }

      // Estimate target token price (look in portfolio or use rough estimate)
      const toToken = portfolio.coins.find(
        (c) => c.symbol.toUpperCase() === toCoin.toUpperCase() ||
          c.coinType === toCoin
      );
      const toPrice = toToken?.price || 0;

      let estimatedOutput: number;
      let priceSource: string;

      if (toPrice > 0 && fromPrice > 0) {
        estimatedOutput = fromValueUsd / toPrice;
        priceSource = "portfolio price data";
      } else {
        // Can't estimate without prices
        return this.failResult(
          "swap",
          `Unable to estimate swap: price data unavailable for ${toPrice === 0 ? toCoin : fromCoin}.`,
          inputParams
        );
      }

      // Apply slippage
      const slippagePct = DEFAULT_SLIPPAGE_PCT;
      const outputAfterSlippage = estimatedOutput * (1 - slippagePct / 100);

      // Risk-based slippage warnings
      let riskTolerance = "moderate";
      try {
        const prefs = await getUserStateService().getPreferences(sender);
        riskTolerance = prefs.risk_tolerance;
      } catch { }

      const slippageThreshold =
        riskTolerance === "conservative"
          ? HIGH_SLIPPAGE_PCT_CONSERVATIVE
          : HIGH_SLIPPAGE_PCT_MODERATE;

      if (slippagePct >= slippageThreshold) {
        warnings.push(
          `Estimated slippage of ${slippagePct}% -- actual slippage on-chain may vary.`
        );
      }

      // Gas estimate (rough: ~0.003 SUI for a typical swap)
      const estimatedGas = "0.003000";

      // Balance after warning
      const balanceWarnings = await this.checkBalanceWarnings(
        sender, 0, parseFloat(estimatedGas), "0x2::sui::SUI"
      );
      warnings.push(...balanceWarnings);

      const fromSymbol = fromToken.symbol;
      const toSymbol = toToken?.symbol || toCoin;

      const narrative =
        `Estimated swap: ${amount} ${fromSymbol} (~$${fromValueUsd.toFixed(2)}) -> ` +
        `~${outputAfterSlippage.toFixed(4)} ${toSymbol} ` +
        `(after ~${slippagePct}% est. slippage). ` +
        `Estimated gas: ~${estimatedGas} SUI. ` +
        `Price source: ${priceSource}.`;

      const result: SimulationResult = {
        type: "swap",
        success: true,
        narrative,
        estimatedGas,
        warnings,
        details: {
          fromCoin: fromSymbol,
          toCoin: toSymbol,
          inputAmount: amount,
          estimatedOutput: outputAfterSlippage.toFixed(4),
          estimatedSlippage: `${slippagePct}%`,
          fromPrice,
          toPrice,
          valueUsd: fromValueUsd.toFixed(2),
        },
      };

      await this.logSimulation(sender, result, inputParams);
      return result;
    } catch (err: any) {
      console.error(`[Simulation] Swap estimation failed:`, err?.message);
      return this.failResult("swap", `Estimation error: ${err?.message}`, inputParams, warnings);
    }
  }

  // ── Stake Simulation ──────────────────────────────────────────────

  /**
   * Simulates staking SUI with a validator using dry-run.
   */
  async simulateStake(
    sender: string,
    validatorAddress: string,
    amount: string
  ): Promise<SimulationResult> {
    const inputParams = { sender, validatorAddress, amount };
    const warnings: string[] = [];

    try {
      if (!this.isValidAddress(sender) || !this.isValidAddress(validatorAddress)) {
        return this.failResult("stake", "Invalid sender or validator address.", inputParams);
      }

      const amountMist = BigInt(Math.floor(parseFloat(amount) * MIST_PER_SUI));

      // Build staking PTB
      const tx = new Transaction();
      tx.setSender(sender);

      const [stakeCoin] = tx.splitCoins(tx.gas, [amountMist]);
      tx.moveCall({
        target: "0x3::sui_system::request_add_stake",
        arguments: [
          tx.object("0x5"), // SuiSystemState object
          stakeCoin,
          tx.pure.address(validatorAddress),
        ],
      });

      // Dry-run
      const serialized = await tx.build({ client: this.client });
      const dryRun = await this.client.dryRunTransactionBlock({
        transactionBlock: Buffer.from(serialized).toString("base64"),
      });

      const gasUsed = dryRun.effects?.gasUsed;
      const totalGasMist =
        BigInt(gasUsed?.computationCost || "0") +
        BigInt(gasUsed?.storageCost || "0") -
        BigInt(gasUsed?.storageRebate || "0");
      const gasSui = Number(totalGasMist) / MIST_PER_SUI;

      // Balance warnings
      const balanceWarnings = await this.checkBalanceWarnings(
        sender, parseFloat(amount), gasSui, "0x2::sui::SUI"
      );
      warnings.push(...balanceWarnings);

      const status = dryRun.effects?.status?.status;
      if (status !== "success") {
        return this.failResult(
          "stake",
          `Dry-run failed: ${dryRun.effects?.status?.error || "Unknown error"}`,
          inputParams,
          warnings
        );
      }

      const narrative =
        `Simulated: Stake ${amount} SUI with validator ${validatorAddress.slice(0, 8)}...${validatorAddress.slice(-4)}. ` +
        `Estimated gas: ${gasSui.toFixed(6)} SUI. ` +
        `Staked SUI will be locked until the end of the current epoch.`;

      const result: SimulationResult = {
        type: "stake",
        success: true,
        narrative,
        estimatedGas: gasSui.toFixed(6),
        warnings,
        serializedTx: Buffer.from(serialized).toString("base64"),
        details: {
          amount,
          validatorAddress,
          gasBreakdown: {
            computation: gasUsed?.computationCost,
            storage: gasUsed?.storageCost,
            rebate: gasUsed?.storageRebate,
          },
        },
      };

      await this.logSimulation(sender, result, inputParams);
      return result;
    } catch (err: any) {
      console.error(`[Simulation] Stake simulation failed:`, err?.message);
      return this.failResult("stake", `Simulation error: ${err?.message}`, inputParams, warnings);
    }
  }

  // ── Audit Logging ─────────────────────────────────────────────────

  /**
   * Records a simulation in the audit log.
   */
  private async logSimulation(
    walletAddress: string,
    result: SimulationResult,
    inputParams: Record<string, any>
  ): Promise<void> {
    try {
      await this.supabase.from("simulation_logs").insert({
        wallet_address: walletAddress,
        simulation_type: result.type,
        input_params: inputParams,
        result: {
          success: result.success,
          narrative: result.narrative,
          estimatedGas: result.estimatedGas,
          details: result.details,
        },
        warnings: result.warnings,
      });
    } catch (err: any) {
      console.warn(`[Simulation] Audit log failed: ${err?.message}`);
    }
  }

  /**
   * Fetches recent simulation logs for a wallet.
   */
  async getRecentSimulations(
    walletAddress: string,
    limit: number = 10
  ): Promise<SimulationLog[]> {
    const { data, error } = await this.supabase
      .from("simulation_logs")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[Simulation] Failed to fetch logs:`, error.message);
      return [];
    }
    return (data || []) as SimulationLog[];
  }

  /**
   * Marks a simulation as executed with the real tx digest.
   */
  async markExecuted(simulationId: number, txDigest: string): Promise<boolean> {
    const { error } = await this.supabase
      .from("simulation_logs")
      .update({ executed: true, execution_tx_digest: txDigest })
      .eq("id", simulationId);

    if (error) {
      console.error(`[Simulation] Failed to mark executed:`, error.message);
      return false;
    }
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Checks balance post-tx and generates warnings.
   */
  private async checkBalanceWarnings(
    sender: string,
    spentAmount: number,
    gasSui: number,
    coinType: string
  ): Promise<string[]> {
    const warnings: string[] = [];

    try {
      if (coinType === "0x2::sui::SUI") {
        const balance = await this.client.getBalance({
          owner: sender,
          coinType: "0x2::sui::SUI",
        });
        const currentSui = Number(BigInt(balance.totalBalance)) / MIST_PER_SUI;
        const remaining = currentSui - spentAmount - gasSui;

        if (remaining < GAS_BUFFER_SUI) {
          warnings.push(
            `After this transaction you'll have only ~${remaining.toFixed(4)} SUI remaining -- ` +
            `this may be insufficient for future gas fees.`
          );
        } else if (remaining < LOW_BALANCE_THRESHOLD_SUI) {
          warnings.push(
            `Your SUI balance will drop to ~${remaining.toFixed(4)} SUI after this transaction.`
          );
        }
      }
    } catch {
      // Non-critical
    }

    return warnings;
  }

  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{64}$/.test(address);
  }

  private failResult(
    type: SimulationType,
    message: string,
    inputParams: Record<string, any>,
    warnings: string[] = []
  ): SimulationResult {
    const result: SimulationResult = {
      type,
      success: false,
      narrative: message,
      estimatedGas: "0",
      warnings,
      details: {},
    };

    // Still log failed simulations for audit
    this.logSimulation(inputParams.sender || "", result, inputParams).catch(() => { });

    return result;
  }
}

// ── Singleton ────────────────────────────────────────────────────────
let instance: SimulationService | null = null;

export function getSimulationService(): SimulationService {
  if (!instance) instance = new SimulationService();
  return instance;
}
