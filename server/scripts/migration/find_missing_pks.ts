import "dotenv/config";

const NEW_URL = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL!;
const PAT = process.env.SUPABASE_PAT || "sbp_3eebf6fb2f93b0795a099f9b7bbf5f153c0dbc15";

const newProjectRef = new URL(NEW_URL).hostname.split(".")[0];

async function runSQLOnNewProject(sql: string) {
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
    return null;
  }
  return res.json();
}

import * as fs from "fs";

async function run() {
  const sql = `
    SELECT t.table_name, 
           array_agg(c.column_name::text) as columns
    FROM information_schema.tables t
    JOIN information_schema.columns c ON c.table_name = t.table_name AND c.table_schema = 'public'
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        WHERE tc.table_name = t.table_name AND tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      )
    GROUP BY t.table_name;
  `;

  const result = await runSQLOnNewProject(sql);
  fs.writeFileSync("missing_pks.json", JSON.stringify(result, null, 2));
  console.log("Saved to missing_pks.json");
}

run().catch(console.error);
