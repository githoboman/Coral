# Corral task runner — mirrors CLAUDE.md §6. `just check-all` = everything CI runs.
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default: check-all

# ── TypeScript (v3 stack) ─────────────────────────────────────────────
core-build:
    npm --prefix packages/core run build

core-test:
    npm --prefix packages/core test

server-build:
    npm --prefix server run build

server-test:
    npm --prefix server test

app-build:
    npm --prefix app run build

app-lint:
    npm --prefix app run lint

# ── Contracts ─────────────────────────────────────────────────────────
forge-build:
    forge build --root contracts

forge-test:
    forge test --root contracts -vvv

# Security-critical: the 25-case violation matrix
violations:
    forge test --root contracts --match-path test/Violations.t.sol

# ── Rust (v2 legacy — retires at T-005 once @corral/core reaches parity) ──
rust-check:
    cargo check --workspace

rust-test:
    cargo test --workspace

check-all: server-build app-build forge-build rust-check
