# Tovira Leaderboard Management Scripts

These scripts are located in `server/scripts/` and should be run from the `server` directory using `npx tsx`.

## 1. Boost User XP (Manual Overrides)
Use this to manually set a user's XP in the database. This value is protected from being overwritten by the blockchain indexer unless the on-chain value becomes HIGHER than this boost.

**Command:**
`npx tsx scripts/boost_user.ts <wallet_address_or_username> <target_xp_amount>`

**Example:**
`npx tsx scripts/boost_user.ts Shiho 166`

---

## 2. Compare XP (Blockchain vs. Database)
Use this to check the synchronization status of any user. It compares the decentralized Sui on-chain truth with the live Supabase display value.

**Command:**
`npx tsx scripts/compare_xp.ts <wallet_address_or_username>`

**Example:**
`npx tsx scripts/compare_xp.ts Sal`

---

## Notes:
- Scripts automatically resolve usernames to wallet addresses.
- Ensure your `.env` file is properly configured with `SUI_NETWORK` and `SUI_PACKAGE_ID`.
