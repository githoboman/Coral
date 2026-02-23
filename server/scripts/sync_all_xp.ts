import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { getSupabaseClient } from "../src/config/supabase.js";
import dotenv from "dotenv";

dotenv.config();

const NETWORK = (process.env.SUI_NETWORK || "testnet") as "testnet" | "mainnet";
const PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });
const supabase = getSupabaseClient();

const eventTypes = [
    `${PACKAGE_ID}::points::PointsClaimed`,
    `${PACKAGE_ID}::task_points::TaskPointsClaimed`,
    `${PACKAGE_ID}::points::CheckInCompleted`
];

async function getExhaustiveOnChainXP(wallet: string): Promise<number> {
    let maxBalance = 0;
    const normalizedTarget = wallet.toLowerCase();
    const targetSuffix = normalizedTarget.replace("0x", "").padStart(64, "0");

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

                    if (eventWallet === normalizedTarget || eventSuffix === targetSuffix) {
                        const balance = parseInt(data.new_balance || "0", 10);
                        if (balance > maxBalance) {
                            maxBalance = balance;
                        }
                    }
                }

                hasNextPage = response.hasNextPage;
                cursor = response.nextCursor;
            }
        } catch (err: any) {
            console.warn(`[SYNC] Could not scan ${type} for ${wallet}:`, err.message);
        }
    }

    return maxBalance;
}

async function runSync() {
    console.log("=== EXHAUSTIVE SUI -> SUPABASE SYNC ===");
    console.log(`Targeting Database: ${process.env.SUPABASE_URL}`);
    console.log(`Targeting Network:  ${NETWORK}`);
    console.log("---------------------------------------");

    // Fetch all users
    let allUsers: any[] = [];
    let page = 0;
    const limit = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('wallet_address, username, points')
            .range(page * limit, (page + 1) * limit - 1);

        if (error) {
            console.error("Failed to fetch users:", error);
            process.exit(1);
        }

        if (data && data.length > 0) {
            allUsers = allUsers.concat(data);
            page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`Found ${allUsers.length} users to sync.\n`);

    let updatedCount = 0;

    for (const [index, user] of allUsers.entries()) {
        const addr = user.wallet_address;
        const currentXP = user.points || 0;
        
        process.stdout.write(`\r[${index + 1}/${allUsers.length}] Syncing ${user.username || addr.substring(0,8)}... `);

        // Fetch exhaustive on-chain truth
        const chainXP = await getExhaustiveOnChainXP(addr);

        if (chainXP !== currentXP && chainXP !== 0) {
            // Update Supabase
            const { error } = await supabase
                .from('user_profiles')
                .update({ points: chainXP, xp: chainXP })
                .eq('wallet_address', addr);

            if (error) {
                console.log(`\n❌ Error updating ${addr}: ${error.message}`);
            } else {
                console.log(`\n✅ Updated ${addr}: ${currentXP} -> ${chainXP} XP`);
                updatedCount++;
            }
        } else {
             // If chainXP is 0, we don't zero them out if they had points, just in case they were purely off-chain testing.
             // But if we strictly want on-chain truth:
             if (chainXP === 0 && currentXP !== 0) {
                 const { error } = await supabase
                    .from('user_profiles')
                    .update({ points: 0, xp: 0 })
                    .eq('wallet_address', addr);
                 if (error) {
                    console.log(`\n❌ Error zeroing ${addr}: ${error.message}`);
                 } else {
                    console.log(`\n🚨 Zeroed ${addr}: ${currentXP} -> 0 XP (No on-chain history found)`);
                    updatedCount++;
                 }
             }
        }
    }

    console.log(`\n=== SYNC COMPLETE ===`);
    console.log(`Total users checked: ${allUsers.length}`);
    console.log(`Users corrected:     ${updatedCount}`);
    process.exit(0);
}

runSync().catch(console.error);
