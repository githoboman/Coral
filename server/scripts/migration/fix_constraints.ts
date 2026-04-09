import * as fs from 'fs/promises';
import * as path from 'path';
import 'dotenv/config';

// explicit process fallback for common lint issues in dev containers
const env = typeof process !== 'undefined' ? process.env : ({} as any);

const BACKUP_DIR = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'backup');
const REPAIR_FILE = path.join(typeof process !== 'undefined' ? process.cwd() : '.', 'repair_constraints.sql');

// Identity columns to check for constraints
const PK_CANDIDATES = ['wallet_address', 'id', 'chat_id', 'tx_digest', 'user_id', 'email', 'telegram_user_id'];

async function runConstraintDiscovery() {
  console.log('🔍 Starting Constraint & Primary Key Discovery...');
  
  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const tableFiles = files.filter(f => f.endsWith('.json'));

  if (tableFiles.length === 0) {
    console.error('❌ No backup files found in /backup. Run export_data.ts first.');
    if (typeof process !== 'undefined') process.exit(1);
  }

  let repairSql = `-- 🧱 AUTOMATIC CONSTRAINT REPAIR SQL
-- Generated at: ${new Date().toISOString()}
-- Use this to add Primary Keys to mirrored legacy tables before modernization.

`;

  console.log(`\n📋 Analyzing ${tableFiles.length} tables for identity candidates...`);

  for (const fileName of tableFiles) {
    const table = fileName.replace('.json', '');
    try {
      const content = await fs.readFile(path.join(BACKUP_DIR, fileName), 'utf-8');
      const rows = JSON.parse(content);
      
      if (rows.length === 0) continue;

      // 1. Find columns that exist in the data
      const firstRow = rows[0];
      const cols = Object.keys(firstRow);

      // 2. Identify the best Primary Key candidate
      // Priority: id > wallet_address > chat_id > tx_digest
      let bestCandidate = '';
      if (cols.includes('id')) bestCandidate = 'id';
      else if (cols.includes('wallet_address')) bestCandidate = 'wallet_address';
      else if (cols.includes('chat_id')) bestCandidate = 'chat_id';
      else if (cols.includes('tx_digest')) bestCandidate = 'tx_digest';
      else if (cols.includes('user_id') && table === 'user_profiles') bestCandidate = 'user_id';

      if (bestCandidate) {
        console.log(`   ✅ Table "${table}": Found PK candidate "${bestCandidate}"`);
        
        // 3. Double-check uniqueness in the backup sample (first 1000 rows)
        const sample = rows.slice(0, 1000);
        const values = sample.map(r => r[bestCandidate]);
        const uniqueValues = new Set(values);
        
        if (uniqueValues.size < values.length) {
            console.warn(`      ⚠️ Warning: Candidate "${bestCandidate}" in "${table}" has DUPLICATES in sample! (Adding UNIQUE instead of PK)`);
            repairSql += `-- Table "${table}" has duplicates, adding Index instead of PK\n`;
            repairSql += `CREATE INDEX IF NOT EXISTS idx_${table}_${bestCandidate} ON ${table}("${bestCandidate}");\n\n`;
        } else {
            // Apply PK
            repairSql += `-- Primary Key for "${table}"\n`;
            repairSql += `ALTER TABLE ${table} ADD PRIMARY KEY ("${bestCandidate}");\n\n`;
        }

        // 4. Special case: If column is "id" and it is a number, we also need to reset the sequence
        const val = firstRow[bestCandidate];
        if (bestCandidate === 'id' && typeof val === 'number') {
            repairSql += `-- Reset sequence for "${table}"\n`;
            repairSql += `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table};\n\n`;
        }
      } else {
        console.log(`   ℹ️  Table "${table}": No clear PK candidate found.`);
      }

    } catch (e: any) {
      console.error(`   ❌ Failed to analyze "${table}":`, e.message);
    }
  }

  await fs.writeFile(REPAIR_FILE, repairSql);
  console.log(`\n✨ Repair SQL generated: ${REPAIR_FILE}`);
  console.log('\n🚀 NEXT STEPS:');
  console.log('   1. Run repair_constraints.sql in your Supabase Dashboard.');
  console.log('   2. Run modern_patch.sql to add the system tables.');
}

runConstraintDiscovery().catch(err => {
  console.error('💥 Fatal error during discovery:', err);
  if (typeof process !== 'undefined') process.exit(1);
});
