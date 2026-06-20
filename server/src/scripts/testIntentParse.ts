/** Quick test of the NL trade-intent parser.
 *    npx tsx src/scripts/testIntentParse.ts "swap 30% of my SUI to USDC"
 */
import "dotenv/config";
import { getTradeIntentParser } from "../services/agentWallet/tradeIntentParser.js";

const msg = process.argv.slice(2).join(" ") || "swap 30% of my SUI to USDC";

getTradeIntentParser()
  .parse(msg)
  .then((intent) => {
    console.log("Input:  ", msg);
    console.log("Parsed: ", JSON.stringify(intent, null, 2));
  })
  .catch((e) => {
    console.error("PARSE ERROR:", e?.message || e);
    process.exit(1);
  });
