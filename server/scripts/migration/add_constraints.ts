import "dotenv/config";

const NEW_URL = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL!;
const NEW_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.NEW_SUPABASE_SERVICE_KEY!;
const PAT = process.env.SUPABASE_PAT || "sbp_3eebf6fb2f93b0795a099f9b7bbf5f153c0dbc15";

if (!NEW_URL || !NEW_KEY) {
  console.error("❌ Missing credentials in .env");
  process.exit(1);
}

const newProjectRef = new URL(NEW_URL).hostname.split(".")[0];

async function runSQLOnNewProject(sql: string): Promise<boolean> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${newProjectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ❌ Failed to execute SQL: ${err}`);
    return false;
  }

  return true;
}

async function run() {
  console.log("🚀 Applying missing database constraints...");
  
  const sql = `
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_wallet_address_key UNIQUE (wallet_address);
    ALTER TABLE public.telegram_accounts ADD CONSTRAINT telegram_accounts_wallet_address_key UNIQUE (wallet_address);
  `;

  process.stdout.write("  Applying UNIQUE constraints to user_profiles and telegram_accounts...");
  const ok = await runSQLOnNewProject(sql);
  
  if (ok) {
    console.log(" ✅ Done!");
  } else {
    console.log(" ❌ Failed to add constraints");
  }
}

run().catch(console.error);
