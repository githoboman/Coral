import "dotenv/config";

const NEW_URL = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL!;
const PAT = process.env.SUPABASE_PAT || "sbp_3eebf6fb2f93b0795a099f9b7bbf5f153c0dbc15";

if (!NEW_URL) {
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
  console.log("🚀 Disabling Row Level Security on all public tables...");
  
  const sql = `
    DO $$ DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE ROW LEVEL SECURITY;';
        END LOOP;
    END $$;
  `;

  process.stdout.write("  Applying DISABLE ROW LEVEL SECURITY to all tables...");
  const ok = await runSQLOnNewProject(sql);
  
  if (ok) {
    console.log(" ✅ Done!");
  } else {
    console.log(" ❌ Failed to disable RLS");
  }
}

run().catch(console.error);
