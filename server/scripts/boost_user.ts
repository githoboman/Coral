import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../src/config/supabase.js';
import { getUserManager } from '../src/services/userManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log("Usage: npx tsx scripts/boost_user.ts <wallet_address|username> <xp_amount>");
        process.exit(1);
    }

    const input = args[0];
    const TARGET_XP = parseInt(args[1], 10);

    if (isNaN(TARGET_XP)) {
        console.error("✗ Invalid XP amount. Must be a number.");
        process.exit(1);
    }

    const supabase = getSupabaseClient();
    const userManager = getUserManager();
    let TARGET_WALLET = input;

    // Resolve username to wallet if needed
    if (!input.startsWith("0x")) {
        console.log(`[BOOST] Input "${input}" looks like a username. Resolving...`);
        const wallet = await userManager.findWalletByUsername(input);
        if (!wallet) {
            console.error(`✗ Could not find user with username "${input}"`);
            process.exit(1);
        }
        TARGET_WALLET = wallet;
        console.log(`✓ Resolved "${input}" to ${TARGET_WALLET}`);
    } else {
        TARGET_WALLET = TARGET_WALLET.toLowerCase();
    }

    console.log(`[BOOST] Starting universal boost for ${TARGET_WALLET} to ${TARGET_XP} XP...`);

    // 2. Update Supabase (Persistent database)
    try {
        const { error } = await supabase
            .from('user_profiles')
            .update({ 
                points: TARGET_XP,
                xp: TARGET_XP
            })
            .eq('wallet_address', TARGET_WALLET);

        if (error) {
            console.error(`✗ Failed to update Supabase:`, error);
        } else {
            console.log(`✓ Updated Supabase user_profiles (points & xp) for ${TARGET_WALLET}`);
        }
    } catch (err) {
        console.error(`✗ Supabase update error:`, err);
    }

    console.log(`[BOOST] Universal boost complete!`);
}

run().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
