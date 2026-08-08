/** Decode a base64 unsigned tx and print its moveCall targets, to confirm the
 *  create-tx endpoint targets the published agent_policy package.
 *    npx tsx src/scripts/decodeTx.ts <base64>
 */
import { Transaction } from "@mysten/sui/transactions";

const b64 = process.argv[2];
if (!b64) throw new Error("pass base64 tx bytes");

const tx = Transaction.from(b64);
const data = tx.getData();
for (const [i, cmd] of data.commands.entries()) {
  if ("MoveCall" in cmd && cmd.MoveCall) {
    console.log(`cmd[${i}] MoveCall -> ${cmd.MoveCall.package}::${cmd.MoveCall.module}::${cmd.MoveCall.function}`);
  } else {
    console.log(`cmd[${i}] ${Object.keys(cmd)[0]}`);
  }
}
