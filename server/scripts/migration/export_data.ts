import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import * as https from 'https';
import 'dotenv/config';

// explicit process fallback for common lint issues in dev containers
const env = typeof process !== 'undefined' ? process.env : ({} as any);

// ══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

const OLD_URL = env.OLD_SUPABASE_URL;
const OLD_KEY = env.OLD_SUPABASE_KEY;

if (!OLD_URL || !OLD_KEY) {
  console.error('❌ Error: OLD_SUPABASE_URL and OLD_SUPABASE_KEY must be set in .env');
  if (typeof process !== 'undefined') process.exit(1);
}

const supabase = createClient(OLD_URL, OLD_KEY, {
  auth: { persistSession: false }
});

const BACKUP_DIR = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'backup');

// ══════════════════════════════════════════════════════════════════════
// INTERACTIVE HELPERS
// ══════════════════════════════════════════════════════════════════════

const rl = readline.createInterface({
  input: typeof process !== 'undefined' ? process.stdin : null as any,
  output: typeof process !== 'undefined' ? process.stdout : null as any
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ══════════════════════════════════════════════════════════════════════
// DYNAMIC DISCOVERY (OpenAPI Spec)
// ══════════════════════════════════════════════════════════════════════

async function discoverAllTables(): Promise<string[]> {
  console.log('🔍 performing a full schema scan on the OLD project...');
  
  return new Promise((resolve, reject) => {
    const url = `${OLD_URL}/rest/v1/`;
    const options = {
      headers: { 'apikey': OLD_KEY }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const spec = JSON.parse(data);
          if (spec.definitions) {
            // definitions contains all tables/views exposed via PostgREST
            const tables = Object.keys(spec.definitions);
            resolve(tables.sort());
          } else {
            reject(new Error('OpenAPI spec does not contain "definitions". Ensure Old Project has public tables.'));
          }
        } catch (e) {
          reject(new Error('Failed to parse OpenAPI spec: ' + e));
        }
      });
    }).on('error', (err) => {
      reject(new Error('Network error during scan: ' + err.message));
    });
  });
}

// ══════════════════════════════════════════════════════════════════════
// EXPORT LOGIC
// ══════════════════════════════════════════════════════════════════════

async function exportTable(tableName: string) {
  console.log(`\n📦 Exporting table: ${tableName}...`);
  
  let allRows: any[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        // If it's a view, it might not support range or might have different issues
        if (error.code === '42601' || error.code === 'PGRST100') {
           console.warn(`   ⚠️ Warning for "${tableName}": Possibly a VIEW or RPC-only. Attempting full fetch...`);
           const { data: fullData, error: fullError } = await supabase.from(tableName).select('*');
           if (fullError) throw fullError;
           allRows = fullData || [];
           hasMore = false;
        } else {
           throw error;
        }
      } else {
        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          allRows = [...allRows, ...data];
          console.log(`   - Fetched ${allRows.length} rows...`);
          page++;
          if (data.length < PAGE_SIZE) hasMore = false;
        }
      }
    }

    if (allRows.length > 0) {
      const filePath = path.join(BACKUP_DIR, `${tableName}.json`);
      await fs.writeFile(filePath, JSON.stringify(allRows, null, 2));
      console.log(`✅ Saved ${allRows.length} rows to ${filePath}`);
    } else {
      console.log(`ℹ️  Table "${tableName}" is empty. No file created.`);
    }
  } catch (err: any) {
    console.error(`❌ Error exporting ${tableName}:`, err.message);
  }
}

async function runExport() {
  console.log('🚀 Starting Full Database Mirror Discovery...');
  
  try {
    const foundTables = await discoverAllTables();
    
    if (foundTables.length === 0) {
      console.error('❌ Scan returned 0 tables. Check if public tables exist in the old project.');
      if (typeof process !== 'undefined') process.exit(1);
    }

    console.log('\n────────────────────────────────────────────────────────────');
    console.log(`📋 FULL SCAN DISCOVERED ${foundTables.length} TABLES:`);
    foundTables.forEach(t => console.log(`   - ${t}`));
    console.log('────────────────────────────────────────────────────────────');

    const answer = await ask('\n⚠️  Ready to export ALL data from these tables? (y/n): ');
    
    if (answer.toLowerCase() !== 'y') {
      console.log('🚫 Export cancelled by user.');
      if (typeof process !== 'undefined') process.exit(0);
    }

    await fs.mkdir(BACKUP_DIR, { recursive: true });
    for (const table of foundTables) {
      await exportTable(table);
    }
    
    console.log('\n✨ Mirror export complete!');
  } catch (err: any) {
    console.error('\n💥 Scan failed:', err.message);
    console.error('   Falling back to manual list mode if you update the script.');
  } finally {
    rl.close();
  }
}

runExport().catch(err => {
  console.error('💥 Fatal error during export:', err);
  if (typeof process !== 'undefined') process.exit(1);
});
