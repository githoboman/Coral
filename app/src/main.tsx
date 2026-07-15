import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.tsx";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { initTheme } from "@/hooks/useTheme";
import "./global.css";

// Apply persisted theme (default dark) before first paint to avoid a flash.
initTheme();

import "highlight.js/styles/github-dark.css";

import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
} from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterEnokiWallets } from "./components/auth/RegisterEnokiWallets";
import { RegisterSlushWallet } from "./components/auth/RegisterSlushWallet";

import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";

// ── Sui network config ────────────────────────────────────────────────
const network = (import.meta.env.VITE_SUI_NETWORK || "testnet") as
  | "testnet"
  | "mainnet";
// RPC endpoint. Prefer an explicit VITE_SUI_RPC_URL so production can point at a
// dedicated provider (the shared public fullnode can rate-limit browser origins,
// which breaks on-chain reads and makes the app look blank). Otherwise use the
// official fullnode. In dev, use the vite proxy to avoid CORS.
const testnetRpc = import.meta.env.DEV
  ? (import.meta.env.VITE_SUI_RPC_URL || "/sui-rpc")
  : (import.meta.env.VITE_SUI_RPC_URL || getFullnodeUrl("testnet"));
const { networkConfig } = createNetworkConfig({
  testnet: { url: testnetRpc },
  mainnet: { url: import.meta.env.VITE_SUI_RPC_URL_MAINNET || getFullnodeUrl("mainnet") },
});

// ── Solana config ─────────────────────────────────────────────────────
const SOLANA_RPC =
  import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const solanaWallets = [new PhantomWalletAdapter()];

// ── Wagmi / Ethereum config ───────────────────────────────────────────
const wagmiConfig = createConfig({
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(
      import.meta.env.VITE_ETH_RPC_URL ||
        "https://eth-sepolia.g.alchemy.com/v2/demo",
    ),
  },
});

// Tuned to be gentle on public Sui RPCs, which rate-limit (429) aggressively.
// React Query's defaults (3 retries + refetch-on-focus + short staleness) create
// a request storm against a 429ing node, which spirals. Cap retries, back off
// long, and cache reads so we poll sparingly instead of hammering.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      retryDelay: (attempt) => Math.min(3000 * 2 ** attempt, 30_000),
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

// Capture referral code before any routing redirects happen
const searchParams = new URLSearchParams(window.location.search);
const refCode = searchParams.get("ref");
if (refCode) {
  localStorage.setItem("coral_referral", refCode);
  searchParams.delete("ref");
  const newUrl = window.location.pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");
  window.history.replaceState({}, document.title, newUrl);
  console.log("[REFERRAL] Captured at app boot:", refCode);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <ConnectionProvider endpoint={SOLANA_RPC}>
          <SolanaWalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>
              <SuiClientProvider
                networks={networkConfig}
                defaultNetwork={network}
              >
                <WalletProvider autoConnect>
                  <RegisterEnokiWallets />
                  <RegisterSlushWallet />
                  <Provider store={store}>
                    <BrowserRouter>
                      <AuthProvider>
                        <App />
                      </AuthProvider>
                    </BrowserRouter>
                  </Provider>
                </WalletProvider>
              </SuiClientProvider>
            </WalletModalProvider>
          </SolanaWalletProvider>
        </ConnectionProvider>
      </WagmiProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
