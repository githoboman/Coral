import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({ include: ["buffer", "process"] }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ["coral-server.onrender.com", "localhost", "coral.app", "coral.vercel.app"],
    proxy: {
      "/sui-rpc": {
        // publicnode is a reliable testnet RPC (blockvision/official fullnode 429/404 flakily).
        target: "https://sui-testnet-rpc.publicnode.com",
        changeOrigin: true,
        // Strip the prefix down to "/" (not an empty string, which some targets 404 on).
        rewrite: (path) => path.replace(/^\/sui-rpc\/?/, "/"),
      },
    },
  },
});
