// @corral/core purity contract (T-005b, CLAUDE.md §2.8): the core may import
// nothing but zod and its own files. No network, no db, no chain client, no
// environment reads — portable to any JS runtime. CI fails on violation.
module.exports = {
  forbidden: [
    {
      name: "core-only-zod",
      severity: "error",
      comment:
        "@corral/core must stay pure logic (CLAUDE.md §2.8). Only zod and relative imports are allowed.",
      from: { path: "^src" },
      to: {
        pathNot: "^(src|node_modules/zod)",
      },
    },
    {
      name: "no-node-builtins",
      severity: "error",
      comment: "No Node builtins in core — it must run in any JS runtime.",
      from: { path: "^src" },
      to: { dependencyTypes: ["core"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
