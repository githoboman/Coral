import { getLeaderboardService } from "../src/services/leaderboardService";
import getSupabaseClient from "../src/config/supabase";
import * as readline from 'readline';

// The milestones array used to calculate bonus points
const MILESTONES = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80,
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Daily Limits and Points
const LIMITS = {
  TASK: { FREE: 2, PREMIUM: 4, POINTS: 2 },
  RESEARCH: { FREE: 2, PREMIUM: 5, POINTS: 3 },
  CHAT: { LIMIT: 5, POINTS: 1 },
  SIGNUP_BONUS: 100,
};

// Replicate the exact points calculation logic used in the app
function calculatePointsForStreak(streak: number): number {
  const BASE_POINTS = 1;
  const MILESTONE_BONUS = 5;
  const isMilestone = MILESTONES.includes(streak);
  const milestoneBonus = isMilestone ? MILESTONE_BONUS : 0;
  return BASE_POINTS + milestoneBonus;
}

// Calculate the total points a user would have earned starting from day 1 up to their current streak
function calculateTotalPointsFromStreak(currentStreak: number): number {
  let totalPoints = 0;
  for (let s = 1; s <= currentStreak; s++) {
    totalPoints += calculatePointsForStreak(s);
  }
  return totalPoints;
}

/**
 * Calculates the theoretical maximum points a user could have earned
 * based on their account age, tier, and daily limits.
 */
function calculateTheoreticalMaxPoints(joinedAt: Date, tier: number): number {
  const now = new Date();
  const accountAgeDays = Math.max(1, Math.ceil((now.getTime() - joinedAt.getTime()) / MS_PER_DAY));
  
  const taskLimit = tier === 1 ? LIMITS.TASK.PREMIUM : LIMITS.TASK.FREE;
  const researchLimit = tier === 1 ? LIMITS.RESEARCH.PREMIUM : LIMITS.RESEARCH.FREE;
  
  const dailyMax = 
    (taskLimit * LIMITS.TASK.POINTS) +
    (researchLimit * LIMITS.RESEARCH.POINTS) +
    (LIMITS.CHAT.LIMIT * LIMITS.CHAT.POINTS) +
    1; // 1 base point for check-in

  let totalMax = LIMITS.SIGNUP_BONUS;
  totalMax += dailyMax * accountAgeDays;
  
  // Add milestone bonuses for check-ins
  const completedMilestones = MILESTONES.filter(m => m <= accountAgeDays).length;
  totalMax += completedMilestones * 5;

  return totalMax;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

// Get command line arguments (skipping 'node' and the script path)
const EXPLOITER_IDENTIFIERS = process.argv.slice(2);

async function run() {
  console.log("🚀 Starting advanced user analysis/penalty script...");
  
  if (EXPLOITER_IDENTIFIERS.length === 0) {
    console.log("⚠️ No users provided! Please provide usernames or wallet addresses as arguments.");
    console.log("Example: npx tsx scripts/penalize_user.ts user1 0x123...");
    process.exit(0);
  }

  const supabase = getSupabaseClient();
  const leaderboardService = getLeaderboardService();

  for (const identifier of EXPLOITER_IDENTIFIERS) {
    try {
      console.log(`\n🔍 Analyzing user: ${identifier}...`);

      // 1. Fetch User Profile
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('*')
        .or(`wallet_address.eq.${identifier},username.eq.${identifier}`)
        .single();

      if (userError || !user) {
        console.warn(`⚠️ User ${identifier} not found in database. Skipping.`);
        continue;
      }

      const wallet = user.wallet_address;
      const currentXP = user.points || 0;
      const joinedAt = new Date(user.joined_at || user.created_at);
      const tier = user.subscription_tier || 0;
      const now = new Date();
      const accountAgeDays = Math.ceil((now.getTime() - joinedAt.getTime()) / MS_PER_DAY);

      // 2. Fetch Check-ins
      const { data: checkins, error: checkinError } = await supabase
        .from('checkins')
        .select('streak_day, points_earned')
        .eq('user_id', wallet)
        .order('streak_day', { ascending: false });

      const totalCheckinPoints = checkins?.reduce((sum, c) => sum + (c.points_earned || 0), 0) || 0;
      const maxStreak = checkins?.[0]?.streak_day || 0;

      // 3. Fetch Points History
      const { data: history, error: historyError } = await supabase
        .from('points_history')
        .select('amount, source, reason')
        .eq('user_id', wallet);

      const historyBreakdown = (history || []).reduce((acc: any, item) => {
        acc[item.source] = (acc[item.source] || 0) + (item.amount || 0);
        return acc;
      }, {});

      const waitlistPoints = historyBreakdown['waitlist_points'] || 0;
      const taskPoints = historyBreakdown['task_points'] || 0;
      const chatPoints = historyBreakdown['chat_points'] || 0;
      const researchPoints = historyBreakdown['research_points'] || 0;

      // 4. Calculate Expected and Theoretical Totals
      const recordedActivityPoints = totalCheckinPoints + taskPoints + chatPoints + researchPoints + waitlistPoints + 100;
      const theoreticalMax = calculateTheoreticalMaxPoints(joinedAt, tier) + waitlistPoints;

      console.log(`========================================`);
      console.log(`User:           ${user.username || 'N/A'}`);
      console.log(`Wallet:         ${wallet}`);
      console.log(`Account Age:    ${accountAgeDays} days (Joined: ${joinedAt.toLocaleDateString()})`);
      console.log(`Tier:           ${tier === 1 ? 'Premium' : 'Free'}`);
      console.log(`----------------------------------------`);
      console.log(`Current XP (DB): ${currentXP}`);
      console.log(`----------------------------------------`);
      console.log(`BREAKDOWN OF RECORDED POINTS (History + Checkins):`);
      console.log(`  Signup Bonus: +100`);
      console.log(`  Check-ins:    +${totalCheckinPoints} (Max Streak: ${maxStreak})`);
      console.log(`  Tasks:        +${taskPoints}`);
      console.log(`  Chat:         +${chatPoints}`);
      console.log(`  Research:     +${researchPoints}`);
      console.log(`  Waitlist:     +${waitlistPoints}`);
      console.log(`  TOTAL RECORDED: ${recordedActivityPoints}`);
      console.log(`----------------------------------------`);
      console.log(`THEORETICAL MAXIMUM (Based on account age & limits):`);
      console.log(`  Theoretical Max: ${theoreticalMax}`);
      console.log(`----------------------------------------`);
      
      const historyOffset = currentXP - recordedActivityPoints;
      const theoreticalOffset = currentXP - theoreticalMax;

      if (theoreticalOffset > 0) {
          console.log(`🚨 HARD EXPLOIT DETECTED!`);
          console.log(`   User points exceed theoretical maximum by ${theoreticalOffset} points.`);
      } else if (historyOffset > 0) {
          console.log(`⚠️ HIDDEN POINTS DETECTED!`);
          console.log(`   User points exceed recorded history by ${historyOffset} points.`);
          console.log(`   (This may be an older exploit or unlogged activity)`);
      }

      const totalOffset = Math.max(0, historyOffset, theoreticalOffset);

      if (totalOffset > 0) {
          console.log(`----------------------------------------`);
          const answer = await askQuestion(`❓ User ${user.username || identifier} has an unexplained offset of ${totalOffset} points. Deduct? (y/N): `);
          
          if (answer.toLowerCase() === 'y') {
              console.log(`Deducting ${totalOffset} XP...`);
              await leaderboardService.creditPoints(wallet, -totalOffset);
              
              if (totalOffset > 20) {
                  const resetAnswer = await askQuestion(`❓ High offset detected. Also reset streak? (y/N): `);
                  if (resetAnswer.toLowerCase() === 'y') {
                    await supabase.from('checkins').insert({
                        user_id: wallet,
                        points_earned: 0,
                        streak_day: 0
                    });
                    console.log(`✅ Streak reset.`);
                  }
              }
              
              console.log(`✅ User penalized successfully!`);
          } else {
              console.log(`⏭️ Skipping deduction.`);
          }
      } else {
          console.log(`✅ Points are within valid bounds. No clear exploit detected.`);
      }

    } catch (err) {
      console.error(`❌ Error processing ${identifier}:`, err);
    }
  }

  console.log("\n🏁 Script completed.");
  rl.close();
}

run().catch(err => {
    console.error(err);
    rl.close();
});
