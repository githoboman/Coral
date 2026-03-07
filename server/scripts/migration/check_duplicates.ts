import * as fs from "fs";
import * as path from "path";

const INPUT_DIR = path.join(process.cwd(), "supabase_export");

function checkDuplicates() {
  console.log(`Checking for duplicates in ${INPUT_DIR}...\n`);
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith(".json") && !f.startsWith("_"));

  for (const file of files) {
    const filePath = path.join(INPUT_DIR, file);
    const raw = fs.readFileSync(filePath, "utf-8");
    const rows: any[] = JSON.parse(raw);
    
    if (rows.length === 0) continue;

    // Determine a primary key to check against.
    // We'll guess 'id' or 'user_id' or 'wallet_address'.
    let pk = "id";
    if (!rows[0].hasOwnProperty("id")) {
      if (rows[0].hasOwnProperty("user_id")) pk = "user_id";
      else if (rows[0].hasOwnProperty("address")) pk = "address";
      else if (rows[0].hasOwnProperty("wallet_address")) pk = "wallet_address";
      else pk = Object.keys(rows[0])[0]; // fallback to first key
    }

    const seen = new Set();
    let duplicates = 0;

    for (const row of rows) {
      const keyValue = row[pk];
      // For stringify full object check if no clear pk or composite pk might be needed
      const hash = keyValue !== undefined && keyValue !== null ? String(keyValue) : JSON.stringify(row);
      
      if (seen.has(hash)) {
        duplicates++;
      } else {
        seen.add(hash);
      }
    }

    if (duplicates > 0) {
      console.log(`⚠️  ${file}: Found ${duplicates} duplicate rows (total rows: ${rows.length}, unique: ${seen.size}) using key '${pk}'`);
    }
  }
  console.log("\nDone checking.");
}

checkDuplicates();
