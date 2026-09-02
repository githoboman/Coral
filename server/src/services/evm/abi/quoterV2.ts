// Verified ABI (subset) fetched from Basescan on 2026-08-23 for 0xC5290058841028F1614F3A6F0F5816cAd0df5E27 (Uniswap v3, Base Sepolia).
export const quoterV2Abi = [
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "path",
        "type": "bytes"
      },
      {
        "internalType": "uint256",
        "name": "amountIn",
        "type": "uint256"
      }
    ],
    "name": "quoteExactInput",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amountOut",
        "type": "uint256"
      },
      {
        "internalType": "uint160[]",
        "name": "sqrtPriceX96AfterList",
        "type": "uint160[]"
      },
      {
        "internalType": "uint32[]",
        "name": "initializedTicksCrossedList",
        "type": "uint32[]"
      },
      {
        "internalType": "uint256",
        "name": "gasEstimate",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "tokenIn",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenOut",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint24",
            "name": "fee",
            "type": "uint24"
          },
          {
            "internalType": "uint160",
            "name": "sqrtPriceLimitX96",
            "type": "uint160"
          }
        ],
        "internalType": "struct IQuoterV2.QuoteExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amountOut",
        "type": "uint256"
      },
      {
        "internalType": "uint160",
        "name": "sqrtPriceX96After",
        "type": "uint160"
      },
      {
        "internalType": "uint32",
        "name": "initializedTicksCrossed",
        "type": "uint32"
      },
      {
        "internalType": "uint256",
        "name": "gasEstimate",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
