import getSupabaseClient from "../config/supabase";
import dotenv from "dotenv";
dotenv.config();

const supabase = getSupabaseClient();

const WALLET = process.argv[2] || "0x6788ee9589dd75784972b52fd3415336ef8938b5ff92f6fb18fc80d8a7d4fd5c"; 

async function resetFullStreak() {
  const normalizedWallet = WALLET.toLowerCase();
  console.log(`[RESET-STREAK] FULL streak reset for ${normalizedWallet}...`);
  
  // 1. Delete ALL check-ins for the user
  const { count, error: deleteError } = await supabase
    .from("checkins")
    .delete({ count: 'exact' })
    .eq("user_id", normalizedWallet);

  if (deleteError) throw deleteError;
  console.log(`[RESET-STREAK] Deleted ${count || 0} history rows from checkins.`);

  // 2. Clear streak and last_checkin in user_profile
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({
      checkin_streak: 0,
      last_checkin: null,
      total_checkins: 0,
    })
    .eq("wallet_address", normalizedWallet);

  if (updateError) throw updateError;

  console.log(`✅ COMPLETELY reset streak for ${WALLET}. Starting fresh from day 1.`);
}

resetFullStreak().catch(console.error);
