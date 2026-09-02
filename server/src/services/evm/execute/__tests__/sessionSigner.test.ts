import { describe, expect, it } from "vitest";
import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeUseSignature, localSessionSigner } from "../sessionSigner.js";
import { sessionNonceKey } from "../sessionUserOp.js";

const PK = `0x${"0".repeat(59)}a11ce` as const;
const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

describe("session signer + USE envelope", () => {
  it("signs the raw hash (no EIP-191 prefix) — what OwnableValidator recovers over", async () => {
    const signer = localSessionSigner(PK);
    const sig = await signer.signHash(HASH);
    expect(await recoverAddress({ hash: HASH, signature: sig })).toBe(privateKeyToAccount(PK).address);
    expect(signer.address).toBe(privateKeyToAccount(PK).address);
  });

  it("USE envelope = 0x00 ‖ permissionId(32) ‖ sig(65) — the layout SmartSessions unpacks", async () => {
    const sig = await localSessionSigner(PK).signHash(HASH);
    const pid = "0x9a4efa0aef21562313d5c3a48ea5b0d7c1c40c70c9c45d4a2636cad93b5087f6";
    const env = encodeUseSignature(pid, sig);
    expect(env.slice(0, 4)).toBe("0x00");
    expect(env.slice(4, 68)).toBe(pid.slice(2));
    expect(env.slice(68)).toBe(sig.slice(2));
    expect((env.length - 2) / 2).toBe(1 + 32 + 65);
  });

  it("nonce key places the SmartSessions address so that nonce >> 96 == validator (Safe7579)", () => {
    const ss = "0x00000000008bDABA73cD9815d79069c247Eb4bDA";
    const key = sessionNonceKey(ss);
    const nonce = (key << 64n) | 7n; // EntryPoint: nonce = key << 64 | seq
    expect(nonce >> 96n).toBe(BigInt(ss));
  });
});
