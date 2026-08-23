// Verified ABI fetched from Basescan on 2026-08-23 for 0x000000000033212e272655d8a22402db819477a6 (Base Sepolia).
// Used for post-install read-back verification (CLAUDE.md §2.2). Do not hand-edit;
// re-fetch only alongside a codehash re-pin in addresses.ts.
export const spendingLimitsPolicyAbi = [
  {
    "inputs": [],
    "name": "InvalidInitDataLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "InvalidLimit",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "InvalidTokenAddress",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "ConfigId",
        "name": "id",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "multiplexer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "PolicyNotInitialized",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "ConfigId",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "multiplexer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "PolicySet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "ConfigId",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "multiplexer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "TokenSpent",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "ConfigId",
        "name": "id",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "target",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "callData",
        "type": "bytes"
      }
    ],
    "name": "checkAction",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "ConfigId",
        "name": "id",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "multiplexer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "userOpSender",
        "type": "address"
      }
    ],
    "name": "getPolicyData",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "spendingLimit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "alreadySpent",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "approvedAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "ConfigId",
        "name": "configId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "initData",
        "type": "bytes"
      }
    ],
    "name": "initializeWithMultiplexer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceID",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  }
] as const;
