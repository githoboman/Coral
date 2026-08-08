/** Quick test of the NL trade-intent parser.
 *    npx tsx src/scripts/testIntentParse.ts "swap 30% of my SUI to USDC"
 *
 * Works with or without a real GEMINI_API_KEY: with a valid key it uses Gemini,
 * otherwise it falls back to the deterministic regex parser (see
 * tradeIntentFallback.ts). Either way it prints a structured TradeIntent.
 */
import "dotenv/config";
import { getTradeIntentParser } from "../services/agentWallet/tradeIntentParser.js";

const msg = process.argv.slice(2).join(" ") || "swap 30% of my SUI to USDC";
const key = process.env.GEMINI_API_KEY_TASK || process.env.GEMINI_API_KEY;
const usingLlm = !!key && key.trim().length >= 10 && !/^(dummy|test|changeme|placeholder|your[-_]?key|xxx+)/i.test(key.trim());

getTradeIntentParser()
  .parse(msg)
  .then((intent) => {
    console.log("Parser: ", usingLlm ? "Gemini (LLM)" : "deterministic fallback");
    console.log("Input:  ", msg);
    console.log("Parsed: ", JSON.stringify(intent, null, 2));
  })
  .catch((e) => {
    console.error("PARSE ERROR:", e?.message || e);
    process.exit(1);
  });
