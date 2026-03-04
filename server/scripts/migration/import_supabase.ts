/**
 * import_supabase.ts
 *
 * Imports all JSON data (from export_supabase.ts) into a NEW Supabase project.
 *
 * Usage:
 *   NEW_SUPABASE_URL=https://xxx.supabase.co \
 *   NEW_SUPABASE_SERVICE_KEY=eyJ... \
 *   npx tsx scripts/import_supabase.ts
 *
 * Or just set the two NEW_* variables in your .env temporarily before running.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

// ─── ⚠️  Configure NEW project credentials here ────────────────────────────
// These intentionally use different env var names so you don't accidentally
// overwrite your current project. Set them in your shell before running.
const NEW_SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEW_SUPABASE_URL;
const NEW_SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.NEW_SUPABASE_SERVICE_KEY;
if (!NEW_SUPABASE_URL || !NEW_SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing NEW_SUPABASE_URL or NEW_SUPABASE_SERVICE_KEY");
  console.error(
    "   Set them as environment variables or update this script directly."
  );
  process.exit(1);
}

const supabase = createClient(NEW_SUPABASE_URL, NEW_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const INPUT_DIR = path.join(process.cwd(), "supabase_export");
const BATCH_SIZE = 500;

// Auto-discover and sort tables so parent tables import first
function getExportedTables(): string[] {
  const files = fs.readdirSync(INPUT_DIR)
    .filter((f: string) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f: string) => f.replace(".json", ""));

  // Critical dependency order (parents must be inserted before children)
  const PRIORITY_ORDER = [
    "user_profiles",
    "telegram_accounts",
    "chats",
    "tasks",
    "documents",
    // Everything else can follow safely
  ];

  return files.sort((a, b) => {
    const idxA = PRIORITY_ORDER.indexOf(a);
    const idxB = PRIORITY_ORDER.indexOf(b);
    
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}


async function importTable(tableName: string): Promise<number> {
  const filePath = path.join(INPUT_DIR, `${tableName}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`  ⏭️  Skipping '${tableName}' — no export file found.`);
    return 0;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const rows: any[] = JSON.parse(raw);

  if (rows.length === 0) {
    console.log(`  ⏭️  '${tableName}' is empty, skipping.`);
    return 0;
  }

  console.log(`  📥 Importing '${tableName}' (${rows.length} rows)...`);

  let imported = 0;

  // Insert in batches to avoid payload limits
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from(tableName)
      .upsert(batch, { onConflict: "id", ignoreDuplicates: false });

    if (error) {
      // Some tables don't have 'id' as primary key — fall back to insert
      const { error: insertError } = await supabase
        .from(tableName)
        .insert(batch);

      if (insertError) {
        console.error(
          `     ❌ Error importing batch ${i}–${i + batch.length} of '${tableName}':`,
          insertError.message
        );
        continue;
      }
    }

    imported += batch.length;
    process.stdout.write(
      `\r     ✅ ${imported}/${rows.length} rows inserted...`
    );
  }

  console.log(`\r     ✅ ${imported} rows imported into '${tableName}'.  `);
  return imported;
}

async function run() {
  console.log("🚀 Starting Supabase import...");
  console.log(`   Destination: ${NEW_SUPABASE_URL}`);
  console.log(`   Source dir:  ${INPUT_DIR}\n`);

  if (!fs.existsSync(INPUT_DIR)) {
    console.error(
      `❌ Export directory not found: ${INPUT_DIR}`
    );
    console.error("   Run export_supabase.ts first.");
    process.exit(1);
  }

  // Read manifest if available
  const manifestPath = path.join(INPUT_DIR, "_manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    console.log(`   📋 Manifest: exported at ${manifest.exported_at}`);
    console.log(`   📦 Total rows in export: ${manifest.total_rows}\n`);
  }

  const tables = getExportedTables();
  console.log(`   Found ${tables.length} export files to import.\n`);

  let totalImported = 0;

  for (const table of tables) {
    try {
      const count = await importTable(table);
      totalImported += count;
    } catch (err) {
      console.error(`  ❌ Failed to import '${table}':`, err);
    }
  }

  console.log(`\n✅ Import complete! ${totalImported} total rows imported.`);
  console.log("🔑 Don't forget to update your .env files with the new project credentials!");
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
