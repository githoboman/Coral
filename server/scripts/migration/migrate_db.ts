import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';
import 'dotenv/config';

// explicit process fallback for common lint issues in dev containers
const env = typeof process !== 'undefined' ? process.env : ({} as any);

// ══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

const NEW_URL = env.SUPABASE_URL;
const NEW_KEY = env.SUPABASE_KEY;

if (!NEW_URL || !NEW_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env');
  if (typeof process !== 'undefined') process.exit(1);
}

const supabase = createClient(NEW_URL, NEW_KEY, {
  auth: { persistSession: false }
});

const BACKUP_DIR = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'backup');

// ══════════════════════════════════════════════════════════════════════
// SEED LOGIC
// ══════════════════════════════════════════════════════════════════════

async function checkTableExists(table: string): Promise<boolean> {
  const { error } = await supabase.from(table).select('*').limit(0);
  if (error && error.code === '42P01') return false;
  return !error;
}

async function runSeed() {
  console.log('🚀 Starting Data Seeding (Stage 3)...');

  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const tableFiles = files.filter(f => f.endsWith('.json'));

  if (tableFiles.length === 0) {
    console.error('❌ No backup files found in /backup. Run Stage 1 (Export) first.');
    if (typeof process !== 'undefined') process.exit(1);
  }

  // Determine import order (profiles first to satisfy potential FKs)
  const sortedTables = tableFiles.sort((a, b) => {
    if (a.includes('user_profiles')) return -1;
    if (b.includes('user_profiles')) return 1;
    return 0;
  });

  for (const fileName of sortedTables) {
    const table = fileName.replace('.json', '');
    const ready = await checkTableExists(table);
    
    if (!ready) {
      console.error(`\n❌ Table "${table}" does not exist in NEW project. Run Stage 2 (Create Schema) first.`);
      continue;
    }

    try {
      const content = await fs.readFile(path.join(BACKUP_DIR, fileName), 'utf-8');
      const rows = JSON.parse(content);
      if (rows.length === 0) continue;

      console.log(`\n📦 Seeding ${rows.length} rows into table "${table}"...`);
      const CHUNK_SIZE = 200;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from(table).upsert(chunk);
        if (error) {
           console.error(`     ❌ Error for "${table}":`, error.message);
           // Fallback to individual inserts if batch fails? (Not normally needed)
        } else {
           if (typeof process !== 'undefined') process.stdout.write('.');
        }
      }
      console.log(`\n✅ Finished table "${table}"`);
    } catch (e: any) {
      console.error(`   ❌ Failed to seed "${table}":`, e.message);
    }
  }

  console.log('\n✨ Database seeding complete!');
}

runSeed().catch(err => {
  console.error('💥 Fatal error during seed:', err);
  if (typeof process !== 'undefined') process.exit(1);
});
