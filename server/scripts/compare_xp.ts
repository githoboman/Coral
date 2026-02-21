import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getSupabaseClient } from "../src/config/supabase.js";
import { getUserManager } from "../src/services/userManager.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NETWORK = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });
const supabase = getSupabaseClient();
const userManager = getUserManager();

async function getOnChainXP(wallet: string): Promise<number> {
    const eventTypes = [
        `${PACKAGE_ID}::points::PointsClaimed`,
        `${PACKAGE_ID}::task_points::TaskPointsClaimed`,
        `${PACKAGE_ID}::points::CheckInCompleted`
    ];

    let maxBalance = 0;

    for (const type of eventTypes) {
        let hasNextPage = true;
        let cursor = null;
        let count = 0;

        try {
            while (hasNextPage) {
                const response = await suiClient.queryEvents({
                    query: { MoveEventType: type },
                    cursor,
                    limit: 50,
                    order: "descending"
                });

                count += response.data.length;

                for (const ev of response.data) {
                    const data = ev.parsedJson as any;
                    if (!data) continue;
                    
                    const eventWallet = (data.wallet_address || "").toLowerCase();
                    const eventSuffix = eventWallet.replace("0x", "").padStart(64, "0");
                    const targetSuffix = wallet.toLowerCase().replace("0x", "").padStart(64, "0");
                    const normalizedTarget = wallet.toLowerCase();

                    if (eventWallet === normalizedTarget || eventSuffix === targetSuffix) {
                        const balance = parseInt(data.new_balance || "0", 10);
                        if (balance > maxBalance) {
                            maxBalance = balance;
                        }
                    }
                }

                hasNextPage = response.hasNextPage;
                cursor = response.nextCursor;
                if (count > 5000) break; // Hard limit for search script
            }
        } catch (err) {
            // console.warn(`Could not scan ${type}:`, err.message);
        }
    }

    return maxBalance;
}

async function run() {
    const args = process.argv.slice(2);
    const identifier = args[0];

    if (!identifier) {
        console.log("Usage: npx tsx scripts/compare_xp.ts <username_or_wallet>");
        process.exit(1);
    }

    console.log(`\n🔍 Comparing XP for: ${identifier}...`);

    let wallet = identifier;
    let username = identifier;

    if (!identifier.startsWith("0x")) {
        // Resolve username
        wallet = await userManager.findWalletByUsername(identifier) || "";
        
        if (!wallet) {
            console.error(`✗ Could not find user with username: ${identifier}`);
            process.exit(1);
        }
        username = identifier;
    } else {
        // Find username for wallet
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('username')
            .eq('wallet_address', identifier.toLowerCase())
            .maybeSingle();
        username = profile?.username || "Unknown";
    }

    console.log(`----------------------------------------`);
    console.log(`Username:  ${username}`);
    console.log(`Wallet:    ${wallet}`);

    // 1. Fetch Supabase XP
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('points, xp')
        .eq('wallet_address', wallet.toLowerCase())
        .maybeSingle();
    
    const dbXP = profile?.points || 0;

    // 2. Fetch On-Chain XP
    const chainXP = await getOnChainXP(wallet);

    console.log(`----------------------------------------`);
    console.log(`Supabase XP:  ${dbXP}`);
    console.log(`On-Chain XP:  ${chainXP}`);
    console.log(`----------------------------------------`);

    const diff = dbXP - chainXP;
    if (diff > 0) {
        console.log(`✨ Status: BOOSTED (+${diff} XP offset)`);
        console.log(`   (Supabase is currently the source of truth for this user)`);
    } else if (diff < 0) {
        console.log(`⚠️  Status: OUT OF SYNC (Chain is ahead!)`);
        console.log(`   (The indexer will update Supabase to ${chainXP} on the next run)`);
    } else {
        console.log(`✅ Status: IN SYNC`);
        console.log(`   (Database and Blockchain match perfectly)`);
    }
    console.log(`----------------------------------------\n`);
}

run().catch(console.error);
