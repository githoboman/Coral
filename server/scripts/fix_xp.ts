import { getSupabaseClient } from "../src/config/supabase.js";
import { getUserManager } from "../src/services/userManager.js";
import dotenv from "dotenv";

dotenv.config();

const supabase = getSupabaseClient();
const userManager = getUserManager();

async function run() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: npx tsx scripts/fix_xp.ts <username_or_wallet> <new_xp>");
        process.exit(1);
    }

    const identifier = args[0];
    const newXP = parseInt(args[1], 10);

    let wallet = "";
    let username = "";

    console.log(`🔎 Looking up user: ${identifier}...`);

    if (!identifier.startsWith("0x")) {
        // Resolve username
        wallet = await userManager.findWalletByUsername(identifier) || "";
        if (!wallet) {
            console.error(`✗ Could not find user with username: ${identifier}`);
            process.exit(1);
        }
        username = identifier;
    } else {
        wallet = identifier;
        const profile = await userManager.getUserProfile(wallet);
        username = profile?.username || "Unknown";
    }

    console.log(`----------------------------------------`);
    console.log(`Username:  ${username}`);
    console.log(`Wallet:    ${wallet}`);
    console.log(`Setting XP to:  ${newXP}`);
    console.log(`----------------------------------------`);

    // Fetch current XP to show in the success message
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('points, xp')
        .eq('wallet_address', wallet.toLowerCase())
        .maybeSingle();

    const currentXP = profile?.points || 0;

    console.log(`🔄 Updating database from ${currentXP} to ${newXP} XP...`);

    const { error } = await supabase
        .from('user_profiles')
        .update({ points: newXP, xp: newXP })
        .eq('wallet_address', wallet.toLowerCase());

    if (error) {
        console.error("❌ Failed to update XP:", error.message);
        process.exit(1);
    }

    console.log(`✅ Successfully updated ${username} to ${newXP} XP.`);
    process.exit(0);
}

run().catch(console.error);
