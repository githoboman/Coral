/**
 * Revocation demo — the PRD's required "owner revokes -> agent fails on-chain" proof.
 *
 *   1. (agent) transfer the AgentCapability to the owner.
 *   2. (owner) call policy::revoke -> destroys the capability, deactivates the policy.
 *   3. (agent) attempt to reference the destroyed capability -> tx FAILS on-chain.
 *
 *   $env:AGENT_DEMO_KEY="suiprivkey..."; $env:OWNER_DEMO_KEY="suiprivkey...";
 *   npx tsx src/scripts/agentRevokeDemo.ts
 */
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";

const PKG = "0x2192e9f75e83d8d3814a34bf62a087950f64d053008067a7e1dc0b521aa49cc3";
const POLICY = "0xbe3b17c9a0b634064e7568c7b04ab7d8cc84e7cb1ce8c6b67538688df62892bf";
const CAP = "0x41ddcb94b834a40fcb419708cf22ff9be68a99ae2acefe01f779c63cb4c84fad";
const CLOCK = "0x6";
const DEEPBOOK = "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c";

function kp(envName: string): Ed25519Keypair {
  const pk = process.env[envName];
  if (!pk) throw new Error(`Set ${envName}`);
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(pk).secretKey);
}

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl("testnet") });
  const agent = kp("AGENT_DEMO_KEY");
  const owner = kp("OWNER_DEMO_KEY");
  const ownerAddr = owner.toSuiAddress();

  // 1. Agent hands the capability to the owner so the owner can revoke it.
  console.log("1. Agent transfers capability to owner...");
  const t1 = new Transaction();
  t1.transferObjects([t1.object(CAP)], ownerAddr);
  const r1 = await client.signAndExecuteTransaction({ signer: agent, transaction: t1, options: { showEffects: true } });
  console.log("   ", r1.effects?.status?.status, r1.digest);

  // 2. Owner revokes — destroys the capability, sets is_active=false.
  console.log("2. Owner revokes the policy (destroys capability)...");
  const t2 = new Transaction();
  t2.moveCall({
    target: `${PKG}::policy::revoke`,
    arguments: [t2.object(POLICY), t2.object(CAP), t2.object(CLOCK)],
  });
  const r2 = await client.signAndExecuteTransaction({ signer: owner, transaction: t2, options: { showEffects: true, showEvents: true } });
  console.log("   ", r2.effects?.status?.status, r2.digest);
  if (r2.effects?.status?.status !== "success") throw new Error("revoke failed: " + r2.effects?.status?.error);
  console.log("    PolicyRevoked event:", JSON.stringify(r2.events?.map((e) => e.type)));

  // 3. Agent tries to use the destroyed capability — MUST fail.
  console.log("3. Agent attempts an action with the destroyed capability (expect FAILURE)...");
  try {
    const t3 = new Transaction();
    t3.moveCall({
      target: `${PKG}::policy::validate_action`,
      arguments: [
        t3.object(POLICY),
        t3.object(CAP), // destroyed — input resolution should fail
        t3.pure.u8(0),
        t3.pure.u64(1_000_000),
        t3.pure.string(DEEPBOOK),
        t3.pure.string("0x2::sui::SUI"),
        t3.object(CLOCK),
      ],
    });
    const r3 = await client.signAndExecuteTransaction({ signer: agent, transaction: t3, options: { showEffects: true } });
    console.log("   UNEXPECTED success:", r3.digest, "— revocation did NOT block the agent!");
  } catch (e: any) {
    console.log("   ✅ EXPECTED FAILURE — agent is blocked on-chain:");
    console.log("   ", (e?.message || String(e)).split("\n")[0]);
  }

  console.log("\nRevocation demo complete.");
}

main().catch((e) => { console.error("DEMO ERROR:", e); process.exit(1); });
