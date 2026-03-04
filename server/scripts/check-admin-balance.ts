import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import "dotenv/config";

async function checkAdminBalance() {
  const privateKey = process.env.WALRUS_PRIVATE_KEY;
  if (!privateKey) {
    console.error("WALRUS_PRIVATE_KEY not set in .env");
    return;
  }

  const { secretKey } = decodeSuiPrivateKey(privateKey);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const adminAddress = keypair.toSuiAddress();

  console.log(`Admin Wallet Address: ${adminAddress}`);

  const client = new SuiClient({
    url: getFullnodeUrl("testnet"),
  });

  try {
    const balance = await client.getBalance({
      owner: adminAddress,
    });
    console.log(`Balance: ${Number(balance.totalBalance) / 1000000000} SUI`);
    console.log(`(Raw: ${balance.totalBalance} MIST)`);
  } catch (error) {
    console.error("Error checking balance:", error);
  }
}

checkAdminBalance();
