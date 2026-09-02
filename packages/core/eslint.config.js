// @corral/core lint gate (T-005b). Enforces CLAUDE.md §2.10/§2.14 at the
// linter level: no `any`, no ts-suppressions, and no float paths anywhere in
// the money core. The branded TokenAmount type does the heavy lifting; these
// rules close the escape hatches.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }],
      "@typescript-eslint/no-non-null-assertion": "error",
      // Money discipline: nothing in core may take the float route.
      "no-restricted-globals": ["error", { name: "parseFloat", message: "No float math on money paths (CLAUDE.md §2.10)." }, { name: "parseInt", message: "Use BigInt via TokenAmountSchema." }],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.name='Number']", message: "No Number() coercion in core (CLAUDE.md §2.10)." },
        { selector: "MemberExpression[object.name='Math']", message: "No Math.* on money paths — bigint only." },
        { selector: "TSAsExpression > TSAnyKeyword", message: "No `as any` in core." },
      ],
    },
  },
  {
    // Tests may unwrap and assert freely, but still no any/suppressions.
    // A `!` on a fixture index is the test's assertion (parity with the Rust
    // suite's "in tests, unwrap IS the assertion"); production code keeps
    // the ban (CLAUDE.md §2.14).
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
