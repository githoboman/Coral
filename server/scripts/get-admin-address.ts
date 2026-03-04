import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import * as fs from "fs";
import "dotenv/config";

const privateKey = process.env.WALRUS_PRIVATE_KEY;
if (privateKey) {
  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const adminAddress = keypair.toSuiAddress();
  fs.writeFileSync("admin_address.txt", adminAddress);
}
