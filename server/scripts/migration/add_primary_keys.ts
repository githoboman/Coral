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
  console.log("🚀 Restoring missing Primary Keys...");
  
  // Apply primary key on tables that traditionally use "id"
  // Note: user_profiles and telegram_accounts usually use their wallet_addresses or ID strings too, let's fix the common ones.
  const sql = `
    DO $$ DECLARE
        r RECORD;
    BEGIN
        -- Find tables with an "id" column but no primary key constraint
        FOR r IN (
            SELECT t.table_name
            FROM information_schema.tables t
            JOIN information_schema.columns c ON c.table_name = t.table_name AND c.table_schema = 'public'
            WHERE t.table_schema = 'public' 
              AND c.column_name = 'id'
              AND NOT EXISTS (
                  SELECT 1 FROM information_schema.table_constraints tc
                  WHERE tc.table_name = t.table_name AND tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
              )
        ) LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.table_name) || ' ADD PRIMARY KEY (id);';
        END LOOP;
    END $$;
  `;

  process.stdout.write("  Scanning and applying PRIMARY KEY constraints to tables with an 'id' column...");
  const ok = await runSQLOnNewProject(sql);
  
  if (ok) {
    console.log(" ✅ Done!");
  } else {
    console.log(" ❌ Failed to add constraints");
  }
}

run().catch(console.error);
