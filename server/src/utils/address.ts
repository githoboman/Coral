/**
 * Normalise a Sui wallet address to a consistent format:
 *   - lowercase
 *   - 0x-prefixed
 *   - zero-padded to 64 hex chars (66 total with 0x)
 *
 * This MUST be used before any DB read/write that involves wallet addresses
 * to avoid casing/padding mismatches across tables.
 */
export function normalizeAddr(addr: string): string {
  if (!addr) return "";
  const cleaned = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + cleaned.toLowerCase().padStart(64, "0");
}
