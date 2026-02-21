
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from server/.env
dotenv.config({ path: path.join(__dirname, "../.env") });

const logFile = path.join(__dirname, "debug_run.log");
fs.writeFileSync(logFile, "Starting debug run...\n");

function log(msg: string) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + "\n");
}

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  log("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugRevenue() {
  log("Fetching revenue events...");

  const { data: revenueEvents, error } = await supabase
    .from('revenue_events')
    .select('*');

  if (error) {
    log("Error fetching events: " + JSON.stringify(error));
    return;
  }

  log(`Fetched ${revenueEvents.length} events.`);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  log(`[DEBUG] Cutoff Date: ${thirtyDaysAgo.toISOString()}`);

  let revenueLast30d = 0;
  let totalRevenue = 0;

  for (const e of revenueEvents) {
    /*
      Schema check:
      id, tx_digest, sender, amount, event_type, timestamp
    */

    // Logic from data.ts
    // Only count actual revenue events (ignore task_claim/points)
    if (e.event_type === 'subscription' || e.event_type === 'checkin_fee') {
      const valSui = Number(e.amount) / 1_000_000_000;
      const valUsd = valSui * 1.5; // Mock SUI price

      totalRevenue += valUsd;

      if (e.timestamp) {
        const eventDate = new Date(e.timestamp);
        const isRecent = eventDate >= thirtyDaysAgo;

        log(`Event: ${e.event_type} | Date: ${e.timestamp} | Recent: ${isRecent} | Amount: ${e.amount} | ValUSD: ${valUsd.toFixed(4)}`);

        if (isRecent) {
          revenueLast30d += valUsd;
        }
      } else {
        log(`Event ${e.tx_digest} has no timestamp!`);
      }
    } else {
      // console.log(`Skipping event type: ${e.event_type}`);
    }
  }

  log("--------------------------------------------------");
  log(`Total Lifetime Revenue: $${totalRevenue.toFixed(2)}`);
  log(`Revenue Last 30d:       $${revenueLast30d.toFixed(2)}`);
}

debugRevenue();
