import "dotenv/config";
import getSupabaseClient from "../src/config/supabase.js";

const supabase = getSupabaseClient();

const WALLET_ADDRESS = "0x6788ee9589dd75784972b52fd3415336ef8938b5ff92f6fb18fc80d8a7d4fd5c";

async function checkPoints() {
  console.log(`🔍 Checking unclaimed points for: ${WALLET_ADDRESS}`);

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('wallet_address', WALLET_ADDRESS)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log("❌ User profile not found.");
        return;
      }
      throw error;
    }

    const today = new Date().toISOString().split("T")[0];
    const needsReset = !profile.last_task_reset_date || profile.last_task_reset_date !== today;

    const tasksCreated = needsReset ? 0 : profile.tasks_created_today || 0;
    const tasksClaimed = needsReset ? 0 : profile.tasks_claimed_today || 0;
    const researchCreated = needsReset ? 0 : profile.research_created_today || 0;
    const researchClaimed = needsReset ? 0 : profile.research_claimed_today || 0;

    const claimableTasks = Math.max(0, tasksCreated - tasksClaimed);
    const claimableResearch = Math.max(0, researchCreated - researchClaimed);
    const totalActivities = claimableTasks + claimableResearch;
    const totalClaimablePoints = (claimableTasks * 2) + (claimableResearch * 3);

    console.log("\n📊 Activity Summary (Today):");
    console.log(`   Last Reset Date:   ${profile.last_task_reset_date || "Never"}`);
    console.log(`   Current Date:      ${today}`);
    console.log(`   Needs Reset:       ${needsReset ? "Yes (Points below show live values)" : "No"}`);
    
    console.log("\n📈 Tasks:");
    console.log(`   Created:  ${tasksCreated}`);
    console.log(`   Claimed:  ${tasksClaimed}`);
    console.log(`   Unclaimed: ${claimableTasks}`);

    console.log("\n🧬 Research:");
    console.log(`   Created:  ${researchCreated}`);
    console.log(`   Claimed:  ${researchClaimed}`);
    console.log(`   Unclaimed: ${claimableResearch}`);

    console.log("\n💰 Points:");
    console.log(`   Total Claimable Activities: ${totalActivities}`);
    console.log(`   Total Claimable Points:     ${totalClaimablePoints}`);
    
    console.log("\n🏆 Overall Balance:");
    console.log(`   Total Points Awarded: ${profile.points || 0}`);

  } catch (err) {
    console.error("Error checking points:", err);
  }
}

checkPoints();
