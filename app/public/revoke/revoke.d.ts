// Type declarations for the dependency-free kill-switch page (revoke.js).
// The page itself stays plain JS by design (CLAUDE.md §9); these types let
// the server's encoder-parity test import it without suppressions (§2.14).
export interface ChainConfig {
  readonly name: string;
  readonly smartSessions: string;
  readonly explorer: string;
}
export const CHAINS: Readonly<Record<number, ChainConfig>>;
export function isPermissionEnabledCalldata(permissionId: string, account: string): string;
export function removeSessionCalldata(permissionId: string): string;
export function approvedHashSignature(owner: string): string;
export function execTransactionCalldata(args: { to: string; data: string; signatures: string }): string;
export function buildRevokeTx(args: { chainId: number; account: string; owner: string; permissionId: string }): {
  from: string;
  to: string;
  value: string;
  data: string;
};
export function readPermissionEnabled(
  provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> },
  chainId: number,
  account: string,
  permissionId: string,
): Promise<boolean>;
