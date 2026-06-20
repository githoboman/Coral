/**
 * Minimal live harness for the agent-wallet HTTP layer — boots ONLY the agent
 * routes with a stubbed owner, so we can exercise the real handlers (PTB building,
 * chain reads, swap execution) without the full Supabase/Gemini-dependent server.
 *
 *   $env:DEMO_OWNER="0x..."; npx tsx src/scripts/agentApiHarness.ts
 * Then curl http://localhost:4100/api/agent/...
 *
 * NOTE: This is a TEST harness. It fakes auth (requireAuth -> fixed owner). The real
 * server uses cookie + token auth; this just proves the agent endpoints work live.
 */
import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";

const OWNER = process.env.DEMO_OWNER || "0xc62e1d746e1fdc10deb2fb1445db11be52224fc57fa4257b9672f83cedcab9fa";
const PORT = 4100;

// Stub the auth middleware module BEFORE the router imports it. We do this by
// monkeypatching require cache is brittle under ESM; instead we re-implement the
// few routes we want to hit here by importing the underlying services directly.
async function main() {
  const { getAgentWalletInitializer } = await import("../services/agentWallet/init.js");
  const { getAgentWalletStore } = await import("../services/agentWallet/store.js");
  const { getAgentAlerts } = await import("../services/agentWallet/alerts.js");
  const { buildCreatePolicyTx } = await import("../services/agentWallet/owner/policyCreator.js");
  const { getSuiClient } = await import("../services/agentWallet/config.js");
  const { toBase64 } = await import("@mysten/sui/utils");

  const app = express();
  app.use(express.json());

  // Fake auth: every request is the demo owner.
  const auth = (req: Request & { owner?: string }, _res: Response, next: NextFunction) => {
    req.owner = OWNER;
    next();
  };

  app.post("/api/agent/wallet/init", auth, async (req: any, res) => {
    try {
      const w = await getAgentWalletInitializer().getOrCreate(req.owner);
      res.json({ status: true, data: { agentAddress: w.agentAddress, policyId: w.policyId, bound: Boolean(w.policyId) } });
    } catch (e: any) { res.status(500).json({ status: false, message: e.message }); }
  });

  app.get("/api/agent/wallet", auth, async (req: any, res) => {
    const w = await getAgentWalletStore().getByOwner(req.owner);
    res.json({ status: true, data: w ? { agentAddress: w.agentAddress, policyId: w.policyId, bound: Boolean(w.policyId) } : null });
  });

  app.post("/api/agent/policy/create-tx", auth, async (req: any, res) => {
    try {
      const w = await getAgentWalletInitializer().getOrCreate(req.owner);
      const { budgetCap = "500000000", allowedAssets = ["SUI"], expiryHours = 24, gasReserve = "100000000" } = req.body ?? {};
      const tx = buildCreatePolicyTx({
        agentAddress: w.agentAddress,
        budgetCap: BigInt(budgetCap),
        allowedAssets,
        expiryHours,
        gasReserve: BigInt(gasReserve),
      });
      tx.setSenderIfNotSet(req.owner);
      const bytes = await tx.build({ client: getSuiClient() });
      res.json({ status: true, data: { agentAddress: w.agentAddress, txBytes: toBase64(bytes) } });
    } catch (e: any) { res.status(500).json({ status: false, message: e.message }); }
  });

  app.get("/api/agent/alerts", auth, (req: any, res) => {
    res.json({ status: true, data: getAgentAlerts().list(req.owner) });
  });

  app.listen(PORT, () => {
    console.log(`Agent API harness on http://localhost:${PORT}`);
    console.log(`Owner: ${OWNER}`);
    console.log("Try:");
    console.log(`  curl -X POST http://localhost:${PORT}/api/agent/wallet/init`);
    console.log(`  curl http://localhost:${PORT}/api/agent/wallet`);
    console.log(`  curl -X POST http://localhost:${PORT}/api/agent/policy/create-tx -H "Content-Type: application/json" -d '{}'`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
