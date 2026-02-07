import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile Sui packages that have ESM-only exports
  transpilePackages: [
    '@mysten/dapp-kit',
    '@mysten/enoki',
    '@mysten/sui',
    '@mysten/zklogin',
    'katex',
  ],
  turbopack: {
    resolveAlias: {
      '@mysten/sui/client': '@mysten/sui/dist/client/index.mjs',
      '@mysten/sui/transactions': '@mysten/sui/dist/transactions/index.mjs',
      '@mysten/sui/jsonRpc': '@mysten/sui/dist/jsonRpc/index.mjs',
      '@mysten/sui/cryptography': '@mysten/sui/dist/cryptography/index.mjs',
      '@mysten/sui/zklogin': '@mysten/sui/dist/zklogin/index.mjs',
      '@mysten/sui/utils': '@mysten/sui/dist/utils/index.mjs',
    },
  },
  // Webpack config to handle ESM packages
  webpack: (config, { isServer }) => {
    // Handle ESM packages that don't work well with Next.js bundling
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // Add aliases for Webpack as well
    config.resolve.alias = {
      ...config.resolve.alias,
      '@mysten/sui/client': '@mysten/sui/dist/client/index.mjs',
      '@mysten/sui/transactions': '@mysten/sui/dist/transactions/index.mjs',
      '@mysten/sui/jsonRpc': '@mysten/sui/dist/jsonRpc/index.mjs',
    };

    // Ensure proper handling of ESM
    config.module.rules.push({
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false,
      },
    });

    return config;
  },
};

export default nextConfig;
