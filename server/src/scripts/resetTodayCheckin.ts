import getSupabaseClient from "../config/supabase";
import dotenv from "dotenv";
dotenv.config();

const supabase = getSupabaseClient();

const WALLET = process.argv[2] || "0x6788ee9589dd75784972b52fd3415336ef8938b5ff92f6fb18fc80d8a7d4fd5c"; 
const TODAY = new Date().toISOString().split("T")[0]; // YYYY-MM-DD (UTC)

async function reset() {
  console.log(`[RESET] Deleting today's (${TODAY}) check-ins for ${WALLET}...`);
  
  // 1. Delete today's check-in row from history
  const { count, error: deleteError } = await supabase
    .from("checkins")
    .delete({ count: 'exact' })
    .eq("user_id", WALLET.toLowerCase())
    .eq("checkin_date", TODAY);

  if (deleteError) throw deleteError;
  console.log(`[RESET] Deleted ${count || 0} rows from checkins.`);

  // 2. Reset profile fields so frontend shows "Ready"
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({
      last_checkin: null,
      checkin_streak: 0, // Force a recalculation next time
    })
    .eq("wallet_address", WALLET.toLowerCase());

  if (updateError) throw updateError;

  console.log(`✅ Reset today's check-in for ${WALLET}. Ready to test!`);
}

reset().catch(console.error);