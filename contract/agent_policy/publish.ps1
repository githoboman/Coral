# Publishes the agent_policy package to the active Sui env (testnet) and prints the
# package id ready to paste into server/.env as AGENT_POLICY_PACKAGE_ID.
#
# Usage:  pwsh contract/agent_policy/publish.ps1
# Requires: funded active address (sui client gas), built package.

$ErrorActionPreference = "Stop"
$pkgPath = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Publishing agent_policy from $pkgPath ..." -ForegroundColor Cyan

# --skip-dependency-verification avoids re-fetching the framework over the flaky
# network; the local-pinned Sui dep is already built. JSON output for parsing.
$raw = & sui client publish --json --gas-budget 200000000 --skip-dependency-verification $pkgPath 2>&1 | Out-String

# Surface raw output for debugging, then parse.
$raw | Out-File -FilePath "$pkgPath\last-publish.json" -Encoding utf8

try {
    $json = $raw | ConvertFrom-Json
} catch {
    Write-Host "Could not parse publish output as JSON. Raw output saved to last-publish.json" -ForegroundColor Yellow
    Write-Host $raw
    exit 1
}

$status = $json.effects.status.status
if ($status -ne "success") {
    Write-Host "Publish FAILED: $($json.effects.status.error)" -ForegroundColor Red
    exit 1
}

# The published package is the objectChange with type 'published'.
$published = $json.objectChanges | Where-Object { $_.type -eq "published" }
$packageId = $published.packageId

Write-Host ""
Write-Host "=== PUBLISH SUCCESS ===" -ForegroundColor Green
Write-Host "Digest:     $($json.digest)"
Write-Host "Package id: $packageId" -ForegroundColor Green
Write-Host ""
Write-Host "Add to server/.env:" -ForegroundColor Cyan
Write-Host "AGENT_POLICY_PACKAGE_ID=$packageId"
