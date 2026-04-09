import * as fs from 'fs/promises';
import * as path from 'path';
import 'dotenv/config';

// explicit process fallback for common lint issues in dev containers
const env = typeof process !== 'undefined' ? process.env : ({} as any);

const BACKUP_DIR = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'backup');
const SCHEMA_FILE = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'full_schema.sql');

// ══════════════════════════════════════════════════════════════════════
// DATA-DRIVEN SCHEMA SYNTHESIS
// ══════════════════════════════════════════════════════════════════════

function guessType(val: any, columnName: string): string {
  if (val === null || val === undefined) return 'TEXT'; // Default to text for nulls
  if (typeof val === 'boolean') return 'BOOLEAN';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return 'BIGINT';
    return 'DECIMAL';
  }
  if (Array.isArray(val) || typeof val === 'object') return 'JSONB';
  if (typeof val === 'string') {
    // Check if it's a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return 'UUID';
    // Check if it's a date
    if (!isNaN(Date.parse(val)) && (val.includes('T') || val.includes('-'))) return 'TIMESTAMPTZ';
    // Check if it's a large amount (e.g., SUI/Token balances)
    if (columnName.includes('amount') || columnName.includes('balance') || columnName.includes('points')) {
        if (/^\d+$/.test(val)) return 'BIGINT';
    }
  }
  return 'TEXT';
}

async function synthesizeSchema() {
  console.log('🧪 Synthesizing schema from backup JSON files...');
  
  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const tableFiles = files.filter(f => f.endsWith('.json'));

  if (tableFiles.length === 0) {
    console.error('❌ No backup files found in /backup. Run export_data.ts first.');
    if (typeof process !== 'undefined') process.exit(1);
  }

  let finalSql = `-- UNIFIED SCHEMA GENERATED FROM BACKUP DATA
-- Generated at: ${new Date().toISOString()}

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

`;

  // Track discovered columns to ensure we don't skip anything
  for (const fileName of tableFiles) {
    const tableName = fileName.replace('.json', '');
    console.log(`🔍 Inspecting "${tableName}"...`);
    
    try {
      const content = await fs.readFile(path.join(BACKUP_DIR, fileName), 'utf-8');
      const rows = JSON.parse(content);
      
      if (rows.length === 0) {
        console.warn(`   ⚠️ Table "${tableName}" empty, skipping dynamic column detection.`);
        continue;
      }

      // Aggregate all columns across the first 50 rows (to avoid missing sparse columns)
      const columnMap: Record<string, string> = {};
      const SAMPLE_SIZE = Math.min(rows.length, 50);
      
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const row = rows[i];
        for (const [key, val] of Object.entries(row)) {
          if (!columnMap[key] || columnMap[key] === 'TEXT') {
            const guessed = guessType(val, key);
            if (guessed !== 'TEXT') columnMap[key] = guessed;
            else if (!columnMap[key]) columnMap[key] = 'TEXT';
          }
        }
      }

      // Build the CREATE TABLE statement
      let tableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;
      const columnDefs: string[] = [];
      
      for (const [col, type] of Object.entries(columnMap)) {
        let def = `  "${col}" ${type}`;
        // Common Primary Key Guesses
        if (col === 'id' || col === 'wallet_address' || col === 'chat_id' || col === 'tx_digest') {
            // def += ' PRIMARY KEY'; (Removing automatic PK to avoid duplicate key errors on complex schemas)
        }
        columnDefs.push(def);
      }
      
      tableSql += columnDefs.join(',\n');
      tableSql += `\n);\n\n`;
      finalSql += tableSql;
      
    } catch (e: any) {
      console.error(`   ❌ Failed to parse "${tableName}":`, e.message);
    }
  }

  // Ensure logging table is always included
  finalSql += `
CREATE TABLE IF NOT EXISTS migration_history_logs (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);\n`;

  await fs.writeFile(SCHEMA_FILE, finalSql);
  console.log(`\n✨ Successfully synthesized schema for ${tableFiles.length} tables.`);
  console.log(`📄 Generated: ${SCHEMA_FILE}`);
  console.log('\n⚠️  ACTION REQUIRED:');
  console.log('   1. Run scripts/migration/drop_tables.sql in Supabase Dashboard (if you want to start fresh).');
  console.log('   2. Run the generated full_schema.sql in Supabase Dashboard.');
  console.log('   3. Run migrate_db.ts to seed the data.');
}

synthesizeSchema().catch(err => {
  console.error('💥 Fatal error during schema synthesis:', err);
  if (typeof process !== 'undefined') process.exit(1);
});
