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
        allowedHosts: ["tovira.onrender.com", "localhost", "tovira.xyz"],
        proxy: {
            "/sui-rpc": {
                target: "https://fullnode.testnet.sui.io",
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/sui-rpc/, ""),
            },
        },
    },
});
