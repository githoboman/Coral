import "dotenv/config";

const NEW_URL = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL!;
const NEW_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEW_SUPABASE_SERVICE_KEY!;
const PAT = process.env.SUPABASE_PAT || "sbp_3eebf6fb2f93b0795a099f9b7bbf5f153c0dbc15";

if (!NEW_URL || !NEW_KEY) {
  console.error("❌ Missing credentials in .env");
  process.exit(1);
}

// Extract project ref from URL: https://<ref>.supabase.co
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
  console.log("🧨 Starting database wipe...");
  console.log(`   Target: ${NEW_URL} (ref: ${newProjectRef})\n`);

  // Dynamically get tables and TRUNCATE them
  const sql = `
    DO $$ DECLARE
        r RECORD;
    BEGIN
        -- Disable triggers temporarily to avoid foreign key / replication issues
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE TRIGGER ALL;';
        END LOOP;

        -- Truncate all tables
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE;';
        END LOOP;

        -- Re-enable triggers
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE TRIGGER ALL;';
        END LOOP;
    END $$;
  `;

  process.stdout.write("  🗑️ Truncating all public tables...");
  const ok = await runSQLOnNewProject(sql);
  
  if (ok) {
    console.log(" ✅ Done!");
    console.log("\n▶  You can now securely re-run: npx tsx scripts/migration/import_supabase.ts");
  } else {
    console.log("\n❌ Wipe failed.");
  }
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
