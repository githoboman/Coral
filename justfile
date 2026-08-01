# Corral task runner — mirrors CLAUDE.md §6. `just check-all` = everything CI runs.
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default: check

check:
    cargo check --workspace

clippy:
    cargo clippy --workspace --all-targets -- -D warnings

test:
    cargo test --workspace

deny:
    cargo deny check

# corral-core must always compile to WASM (CLAUDE.md §2.8, C-007)
wasm:
    cargo build --target wasm32-unknown-unknown -p corral-core --features wasm

# Regenerate the frontend's WASM package. CI fails if the checked-in output differs (C-108).
wasm-pack:
    wasm-pack build crates/corral-core --features wasm --target bundler --out-dir ../../apps/web/packages/core-wasm

forge-build:
    forge build --root contracts

forge-test:
    forge test --root contracts -vvv

# Security-critical: the 25-case violation matrix (C-309)
violations:
    forge test --root contracts --match-path test/Violations.t.sol

# Release-blocking encoder differential harness (C-306/C-307)
encoder-diff:
    pnpm --dir harness/encoder-diff test

check-all: check clippy test deny wasm forge-build forge-test
