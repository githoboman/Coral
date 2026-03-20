import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App.tsx";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./global.css";

import "highlight.js/styles/github-dark.css";

import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
} from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegisterEnokiWallets } from "./components/auth/RegisterEnokiWallets";

import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";

import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";

// ─────────────────────────────────────────────────────────────────────
// Global fetch interceptor — adds JWT to all /api/ requests (dev branch)
// ─────────────────────────────────────────────────────────────────────
const originalFetch = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = "";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else if (input instanceof Request) url = input.url;

  if (url.includes("/api/")) {
    const token = localStorage.getItem("tovira_jwt");
    if (token) {
      if (input instanceof Request) {
        try {
          if (!input.headers.has("Authorization")) {
            input.headers.set("Authorization", `Bearer ${token}`);
          }
        } catch (e) {
          /* ignore */
        }
      } else {
        init = init || {};
        const headers = new Headers(init.headers || {});
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        init.headers = headers;
      }
    }
  }
  return originalFetch(input, init);
};

// ── Sui network config ────────────────────────────────────────────────
const network = (import.meta.env.VITE_SUI_NETWORK || "testnet") as
  | "testnet"
  | "mainnet";
const { networkConfig } = createNetworkConfig({
  testnet: {
    url: import.meta.env.DEV ? "/sui-rpc" : getFullnodeUrl("testnet"),
  },
  mainnet: { url: getFullnodeUrl("mainnet") },
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

const queryClient = new QueryClient();

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
