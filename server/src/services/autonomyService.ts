import getSupabaseClient from "../config/supabase";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

export class AutonomyService {
  private supabase = getSupabaseClient();
  private network = (process.env.VITE_SUI_NETWORK || 'testnet') as 'testnet' | 'mainnet';
  private suiClient = new SuiClient({ url: getFullnodeUrl(this.network) });

  /**
   * Check if a user has delegated "Full Control" to the agent
   */
  async isDelegated(userId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('user_profiles')
        .select('preferences')
        .eq('wallet_address', userId)
        .single();

      if (error || !data) return false;
      return !!data.preferences?.agent_autonomy_enabled;
    } catch {
      return false;
    }
  }

  /**
   * Execute a transaction on behalf of the user
   * NOTE: This requires a pre-authorized session or a server-side managed key (Enoki)
   * For this demo/setup, we'll simulate the execution or use Enoki's API if available.
   */
  async executeTokenTransfer(taskId: number, userId: string, params: { recipientAddress: string, amount: string, coinType: string }): Promise<string> {


    // In a real Enoki implementation, we would use the Enoki API key 
    // and the user's session/subject to sign and execute.
    // For now, we'll simulate a successful execution if delegation is enabled.

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock digest
    const mockDigest = `AUTON_${Math.random().toString(36).substring(2, 15)}`;

    // Update task in DB
    await this.supabase
      .from('tasks')
      .update({
        action_status: 'completed',
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId);

    return mockDigest;
  }

  async executeTokenSwap(taskId: number, userId: string, params: { fromCoin: string, toCoin: string, amountToSwap: string }): Promise<string> {


    await new Promise(resolve => setTimeout(resolve, 1500));

    const mockDigest = `AUTON_SWAP_${Math.random().toString(36).substring(2, 15)}`;

    await this.supabase
      .from('tasks')
      .update({
        action_status: 'completed',
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId);

    return mockDigest;
  }
}

export const autonomyService = new AutonomyService();
