/**
 * export_supabase.ts
 *
 * Exports all data from the OLD Supabase project to JSON files.
 *
 * Usage:
 *   npx tsx scripts/export_supabase.ts
 *
 * Output:
 *   Creates a folder ./supabase_export/ with one JSON file per table.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// ─── ⚠️  Configure OLD project credentials here ────────────────────────────
const OLD_SUPABASE_URL = process.env.SUPABASE_URL!;
// Falls back to SUPABASE_KEY if service role key isn't set separately
const OLD_SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY!;
// ───────────────────────────────────────────────────────────────────────────

if (!OLD_SUPABASE_URL || !OLD_SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Dynamically discover all tables by reading the PostgREST OpenAPI spec.
// This works with any key (anon or service role) and returns ALL exposed tables.
async function getAllTables(): Promise<string[]> {
  try {
    const response = await fetch(`${OLD_SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: OLD_SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${OLD_SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const spec: any = await response.json();
    // OpenAPI spec lists tables under "paths" as "/{tableName}"
    const tables = Object.keys(spec.paths || {})
      .map((p) => p.replace(/^\//, ""))           // strip leading slash
      .filter((t) => !t.includes("{") && t !== ""); // exclude parameterized routes

    if (tables.length > 0) return tables.sort();
    throw new Error("No paths found in OpenAPI spec");
  } catch (err) {
    console.warn(`⚠️  Could not auto-discover tables (${err}), using known list as fallback.`);
    return [
      "checkins", "indexer_state", "points_history", "prices",
      "revenue_events", "suggestion_history", "task_drafts",
      "task_history", "tasks", "telegram_accounts", "user_profiles",
      "user_state", "users_monitor", "waitlist_emails",
    ];
  }
}

const OUTPUT_DIR = path.join(process.cwd(), "supabase_export");

async function exportTable(tableName: string): Promise<number> {
  console.log(`  📤 Exporting '${tableName}'...`);

  let allRows: any[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  // Paginate through all rows (avoids row limits)
  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(`     ❌ Error fetching '${tableName}':`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allRows = allRows.concat(data);
    from += PAGE_SIZE;

    if (data.length < PAGE_SIZE) break; // last page
  }

  const filePath = path.join(OUTPUT_DIR, `${tableName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(allRows, null, 2), "utf-8");
  console.log(`     ✅ ${allRows.length} rows → ${tableName}.json`);

  return allRows.length;
}

async function run() {
  console.log("🚀 Starting Supabase export...");
  console.log(`   Source: ${OLD_SUPABASE_URL}`);
  console.log(`   Output: ${OUTPUT_DIR}\n`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const tables = await getAllTables();
  console.log(`   Found ${tables.length} tables: ${tables.join(", ")}\n`);

  let totalRows = 0;

  for (const table of tables) {
    try {
      const count = await exportTable(table);
      totalRows += count;
    } catch (err) {
      console.error(`  ❌ Failed to export '${table}':`, err);
    }
  }

  // Write a manifest for reference
  const manifest = {
    exported_at: new Date().toISOString(),
    source_url: OLD_SUPABASE_URL,
    tables: tables,
    total_rows: totalRows,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "_manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  console.log(`\n✅ Export complete! ${totalRows} total rows exported.`);
  console.log(`📁 Files saved to: ${OUTPUT_DIR}`);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
