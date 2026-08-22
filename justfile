# Corral task runner — mirrors CLAUDE.md §6. `just check-all` = everything CI runs.
set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

default: check-all

core-build:
    npm --prefix packages/core run build

core-test:
    npm --prefix packages/core test

core-lint:
    npm --prefix packages/core run lint

server-build:
    npm --prefix server run build

server-test:
    npm --prefix server test

app-build:
    npm --prefix app run build

app-lint:
    npm --prefix app run lint

forge-build:
    forge build --root contracts

forge-test:
    forge test --root contracts -vvv

# Security-critical: the 25-case violation matrix
violations:
    forge test --root contracts --match-path test/Violations.t.sol

check-all: core-build core-test core-lint server-build server-test app-build forge-build
