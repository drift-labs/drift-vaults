# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Toolchain

Pinned versions (strict — the build/test scripts enforce them):

- anchor `1.0.0` (via `avm use 1.0.0`)
- rust `1.91.1` (on Apple Silicon, `rustup override set 1.91.1-x86_64-apple-darwin` — the x86 toolchain is required)
- solana/agave `2.3.11`
- node `>=24`

`rust-toolchain.toml` and `build.sh` pin these; don't upgrade casually.

### Anchor 1.0 migration status

The codebase has been migrated from Anchor 0.29 to 1.0. During migration the `drift` crate is consumed as a **local path dep** at `../protocol-v2-shadow/programs/drift` (see `programs/drift_vaults/Cargo.toml`). `drift.so` / `pyth.so` fixtures under `tests/fixtures/` were rebuilt from that same shadow repo — they MUST be regenerated from shadow whenever you pull shadow changes, or the local validator tests will fail on deserialization. The `@drift-labs/sdk` TS dep is similarly pinned to `link:../../../protocol-v2-shadow/sdk` in `ts/sdk/package.json`. Once shadow publishes matching crates.io / npm releases, these can be flipped back.

**Zero-copy struct layout invariants** (enforced by `drift_macros::assert_no_slop` + `static_assertions::const_assert_eq`): every account struct's content (excluding the 8-byte discriminator) must be a multiple of 16 bytes, and all `u128`/`i128` fields must begin at 16-aligned offsets. Rust ≥ 1.77 made `align_of::<u128>() == 16` on x86_64 but SBF stayed at 8 — violating the invariant causes sizeof-divergence between host tests and on-chain bytes. If you add a field to `Vault` / `VaultDepositor` / `TokenizedVaultDepositor` / `VaultProtocol` / `FeeUpdate`, keep all u128/i128 fields grouped near the top (before any `WithdrawRequest` or sub-struct that embeds a u128) and adjust the trailing `padding` array so `(SIZE - 8) % 16 == 0`. The `assert_no_slop` attribute will fail compilation immediately if you get it wrong. See shadow's `docs/alignment-and-native-offsets.md` for the full rationale.

`.cargo/config.toml` has been moved aside to `.cargo/config.toml.pre-anchor1` during migration (it forces vendored-sources from a missing `vendor/` directory). Re-vendor and restore once deps are stable.

## Common commands

Build + run the full anchor test suite (spins up `anchor localnet` in the background, runs jest against it):

```
./test.sh                 # full: build + test
./test.sh --no-build      # reuse last build
./test.sh --detach        # keep validator running after tests
```

Under the hood, `test.sh` calls `build.sh --anchor-test` (which does `anchor build --ignore-keys -- --features anchor-test`) then `yarn anchor-tests`. The `--ignore-keys` flag is required in Anchor 1.0.

Run a single jest test file:

```
ANCHOR_WALLET=~/.config/solana/id.json yarn jest --runInBand --forceExit tests/driftVaults.ts
```

Note: `yarn anchor-tests` copies fresh IDL/types from `target/` into `ts/sdk/src/{idl,types}/` before running jest — if you edit the Rust program, re-run this (not raw `jest`) so the TS SDK sees new types. Or run `yarn update-types && yarn update-idl` manually.

Rust unit tests (in-program, no validator): `cargo test` from repo root. There is a large `tests.rs` module in `programs/drift_vaults/src/` gated on `#[cfg(test)]`.

Lint / format:

```
yarn lint            # eslint (TS)
yarn prettify        # prettier check
yarn prettify:fix    # prettier write
cargo fmt            # rust
```

CLI (manager/depositor operations against a live cluster), run from `ts/sdk/`:

```
cd ts/sdk && yarn cli --help
```

Requires `RPC_URL` + `KEYPAIR_PATH` (or `--url`/`--keypair` flags). See `ts/sdk/README.md` for per-command docs.

## Architecture

This is a Solana Anchor program (`drift_vaults`, program id `vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR`) plus a TypeScript SDK + CLI. Vaults are delegated accounts on top of the Drift perps/spot protocol: a manager runs strategies on Drift, depositors hold pro-rata shares in the vault.

### Rust program (`programs/drift_vaults/src/`)

- `lib.rs` — thin dispatch layer. Every instruction is one function forwarding into `instructions::*`. Start here to find the surface.
- `instructions/` — one file per instruction. Constraint macros live in `constraints.rs`.
- `state/` — account definitions. The heavy logic lives in these, not the instructions:
  - `vault.rs` (~58KB) and `vault_depositor.rs` (~82KB) are the core share-accounting engines (deposits, withdraws, profit share, rebase, fuel distribution). Most behavior changes touch these.
  - `tokenized_vault_depositor.rs` — SPL-token-wrapped depositor position (see `tokenize_shares` / `redeem_tokens` instructions).
  - `vault_protocol.rs` — optional protocol-fee side of a vault (initialized via `initialize_vault_with_protocol`).
  - `fee_update.rs`, `withdraw_request.rs`, `withdraw_unit.rs`, `events.rs`, `traits.rs`, `math.rs`, `account_maps.rs` — supporting types.
- `drift_cpi.rs` / `token_cpi.rs` — CPI wrappers into drift program and SPL token.
- `tests.rs` (~127KB) — exhaustive Rust-side unit tests for share-math edge cases; run via `cargo test`.

Three main actor roles show up across instructions: **manager** (runs the vault, has most privileged ix), **depositor** (deposits/withdraws shares), **protocol** (optional fee recipient, with its own `protocol_*` withdraw flow). There is also an `admin_*` set for Drift-team-controlled fee/class migrations.

Withdrawals are two-phase: `request_withdraw` → wait `redeem_period` → `withdraw`. Same pattern for manager and protocol variants and for insurance-fund stake removal.

### TypeScript SDK (`ts/sdk/src/`)

- `vaultClient.ts` (~103KB) — the primary client; wraps every program instruction plus helpers to fetch/derive accounts. This is what the CLI and tests consume.
- `accounts/`, `accountSubscribers/` — account fetching/subscription layer.
- `addresses.ts` — PDA derivations (vault, vault depositor, tokenized depositor, insurance fund stake, etc.).
- `idl/` and `types/` — **generated**, do not hand-edit. They are copied from `target/` by `yarn update-idl` / `yarn update-types` (invoked automatically by `yarn anchor-tests`).
- `math/`, `parsers/` — view-side helpers.

### CLI (`ts/sdk/cli/`)

`cli.ts` registers commander subcommands; actual work is in `cli/commands/*`. Supports ledger signing via `ledgerWallet.ts` (pass a `usb://ledger/...` path as `--keypair`).

### Tests (`tests/`)

Jest integration tests run against `anchor localnet` (started by `test.sh`). `tests/fixtures/` contains the drift + pyth + metaplex programs and accounts loaded into genesis (see `Anchor.toml`). `driftVaults.ts` is the broad end-to-end suite; other files target narrower features (fuel distribution, fee updates, tokenized shares, trusted vaults, etc.).

## Gotchas

- After editing the Rust program, the TS side will look stale until IDL/types are regenerated. `yarn anchor-tests` handles this; raw `jest` does not.
- `anchor build --ignore-keys` must run with `--features anchor-test` for the integration test suite (done by `build.sh --anchor-test`). Unit tests (`cargo test`) use `#[cfg(test)]` gating independently.
- One fixture-based unit test (`apply_profit_share_on_net_hwm_example`) is `#[ignore]`d — its base64 Vault bytes encode the pre-reorder layout. Re-capture the fixture if/when you need it.
- The macOS "blockstore error" on `anchor test` is fixed by installing `gnu-tar` and putting it ahead of BSD tar on `PATH` (see README).
- On Apple Silicon, the program is built with the x86 rust toolchain — do not switch to aarch64.
- `ahash` is pinned to `0.8.11` in `Cargo.lock`; older `0.8.6` uses the removed `#[feature(stdsimd)]` and will fail to compile on Rust 1.91. If you regenerate `Cargo.lock`, confirm ahash is ≥ 0.8.7.
