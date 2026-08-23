// CorralJournal ABI (contracts/src/CorralJournal.sol, Basescan-verified at
// 0x4fd6dad6e04Cf974E94f9AF94B651766c1b6036F). One function, one event.
export const corralJournalAbi = [
  {
    type: "function",
    name: "log",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "intentHash", type: "bytes32" },
      { name: "strategyId", type: "bytes32" },
      { name: "seq", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Logged",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "intentHash", type: "bytes32", indexed: true },
      { name: "strategyId", type: "bytes32", indexed: false },
      { name: "seq", type: "uint32", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
] as const;
