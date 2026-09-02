// ABI of contracts/src/CorralRateLimitPolicy.sol (D26), generated from the Foundry build on 2026-08-23.
// Regenerate when the contract changes: forge build && node (see progress log).
export const corralRateLimitPolicyAbi = [
  {
    "type": "function",
    "name": "MAX_LIMIT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "checkUserOpPolicy",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "ConfigId"
      },
      {
        "name": "userOp",
        "type": "tuple",
        "internalType": "struct PackedUserOperation",
        "components": [
          {
            "name": "sender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "initCode",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "callData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "accountGasLimits",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "preVerificationGas",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "gasFees",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymasterAndData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "signature",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getRateLimitConfig",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "ConfigId"
      },
      {
        "name": "multiplexer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "limit",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "window",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "count",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getUsedInWindow",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "ConfigId"
      },
      {
        "name": "multiplexer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "asOf",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initializeWithMultiplexer",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "configId",
        "type": "bytes32",
        "internalType": "ConfigId"
      },
      {
        "name": "initData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceID",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "event",
    "name": "PolicySet",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "indexed": false,
        "internalType": "ConfigId"
      },
      {
        "name": "multiplexer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "PolicyNotInitialized",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "ConfigId"
      },
      {
        "name": "multiplexer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const;
