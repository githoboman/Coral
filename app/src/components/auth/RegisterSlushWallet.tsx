import { useEffect } from "react";
import { registerSlushWallet } from "@mysten/slush-wallet";

/**
 * Registers the Slush web wallet so Coral is usable on MOBILE browsers, where Sui
 * wallet *extensions* don't exist. Slush is a hosted web wallet (and mobile app)
 * that connects via a popup/redirect — no extension install — so it appears in the
 * dapp-kit wallet list on phones. Mirrors the RegisterEnokiWallets pattern:
 * mount once near the WalletProvider; it self-unregisters on unmount.
 */
export function RegisterSlushWallet() {
  useEffect(() => {
    try {
      const result = registerSlushWallet("Coral", {
        origin: "https://my.slush.app",
      });
      return result?.unregister;
    } catch (err) {
      console.warn("[Slush] wallet registration failed:", err);
    }
  }, []);

  return null;
}
