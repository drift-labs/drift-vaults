# Spot E2E Coverage Handoff

## Context

When the Anchor 1.0 / shadow-drift migration re-enabled the seven `it.skip`'d
tests in `tests/driftVaults.ts`, the four `SpotDlobTradingDisabled` tests had to
be rewritten to use SOL-PERP instead of SOL-spot, because shadow drift
permanently stubs `placeAndTakeSpotOrder` / `placeAndMakeSpotOrder` to throw.
This was the right call (the tests are about vault behavior under equity
movement, and perp gets us there), but it left three gaps in coverage that this
doc tracks.

The rewrite touched these tests in `tests/driftVaults.ts`:

- `Redeem vault tokens with profit share, profitable`
- `Redeem vault tokens with profit share, not profitable`
- `Disallow tokenize after vault rebases, allow redeeming tokens`
- `Test manager cancel withdraw owning 100% of vault`

…plus the shared `doWashTrading` and `initializeSolSpotMarketMaker` helpers in
`tests/common/testHelpers.ts`. All four tests now drain equity via
`placeAndTakePerpOrder` + (in the rebase test) a `setFeedPrice` oracle crash,
rather than via real spot fills against the spot DLOB.

## What's no longer exercised

### 1. Vault holding a non-USDC spot balance mid-test

The original spot version had the vault buy SOL spot, then sit with mixed
USDC + SOL spot balances while equity moved with the SOL oracle. The perp
rewrite has the vault hold USDC + a SOL-PERP position instead.

**Risk:** any `drift_vaults` code path that's specific to summing two positive
spot balances (cross-spot accounting in `Vault::calculate_equity` →
`calculate_user_equity`) is no longer hit by the rebase / tokenize tests. The
vault is initialized with `spot_market_index: 0` (USDC) so the impact is small,
but it's not zero — e.g. profit-share math reads the vault's USDC spot balance
to compute total equity, and a buggy interaction with a non-USDC spot position
would slip past these tests.

**Status: not addressed — original suggestion infeasible.** The handoff
originally suggested driving the vault into a mixed USDC/SOL spot state via
drift's `handle_begin_swap` / `handle_end_swap`. On closer inspection that
path is closed:

- `drift_vaults` has **no swap instruction wrapper** — none of the 49
  instructions in `programs/drift_vaults/src/instructions/` CPI into drift's
  swap pair, and `drift_cpi.rs` has no swap accounts struct. Adding one is a
  ~300-line production feature change (new instruction file, lib.rs entry,
  drift_cpi wrapper, vaultClient TS method, IDL regen, plus security review of
  manager-controlled swap surface) — well beyond the scope of test coverage
  backfill.
- Calling drift's swap directly from `managerDriftClient` (the vault's
  delegate) does work as far as `can_sign_for_user` is concerned
  (`programs/drift/src/instructions/constraints.rs:18`), but drift's swap
  introspects the surrounding instructions and, **when the signer is the
  delegate rather than the user.authority**, restricts the intermediate
  instructions to `WHITELISTED_SWAP_PROGRAMS` only — Jupiter v3/v4/v6,
  openbook, dflow, titan. Plain `Token::transfer` / `AssociatedToken` is
  rejected (`programs/drift/src/instructions/user.rs:3624` —
  `if !delegate_is_signer { whitelisted_programs.push(Token::id()); ... }`).
  So the simplest "two manual transfers" middle-ix pattern used by the
  drift-side `tests/spotSwap.ts` reference is unavailable to a vault context;
  it would require wiring openbook (or another whitelisted DEX) into the
  drift-vaults test fixtures.
- `manager_borrow` (the closest existing instruction that touches a
  non-`vault.spot_market_index` market) enforces
  `drift_spot_market_vault.mint == vault_token_account.mint`
  (`programs/drift_vaults/src/instructions/manager_borrow.rs:75-79`), so it
  can only borrow the vault's own spot asset. It also requires
  `is_trusted_vault_class()`. So borrow can't synthesise a cross-spot
  position either.

**Achievable alternatives if this gap becomes material:**

1. *Rust unit test in `programs/drift_vaults/src/tests.rs`* — construct a
   synthetic `User` with positive spot balances on indexes 0 and 1, push it
   through `Vault::calculate_equity`, then exercise `apply_rebase` /
   `apply_profit_share` over the resulting equity. Skips the validator and
   the swap problem entirely; covers the math.
2. *Test a SOL-denominated vault* (`spot_market_index: 1`) — the vault
   numeraire-conversion in `vault.rs:510-518` only runs when the vault's
   spot market isn't USDC, and that path is currently uncovered by any
   integration test. A vault initialised with `spot_market_index: 1` and
   funded with wrapped SOL exercises the same equity-conversion code that
   gap #1 worries about, without needing cross-spot balances.
3. *Add a `swap` wrapper to drift-vaults* — a real production feature.
   Should be its own RFC, not a test-coverage backfill.

### 2. Equity drain via fees vs. via oracle

Spot wash-trading drained equity smoothly through real maker/taker fees over
~100 iters. The perp rewrite of the rebase test drains equity in a single
`setFeedPrice` jump.

**Risk:** if `Vault::apply_rebase` or `apply_profit_share` ever behaves
differently when equity declines in many small steps vs. one big step (e.g. an
intermediate `apply_rebase` firing during the drift, fee/share interactions
during a many-step decline, hwm tracking that resets on each call), that
dynamic is no longer covered end-to-end. The Rust unit tests in
`programs/drift_vaults/src/tests.rs` cover share-math edges per iteration so
the math itself is exercised — but the *integration* loop (drift CPI →
drift_vaults CPI → vault state mutation, repeated) is not.

**Status: parametrization complete; full integration test deferred.**
`doWashTrading` in `tests/common/testHelpers.ts` now takes optional
`oracleNudgeBpsPerIter` + `oracleAccount` + `oracleProgram` params (small
per-iter `setFeedPrice` + `setFeedTwap` shifts) and a `midLoopHook` +
`midLoopHookEvery` pair that fires inside the drain loop — typically used to
call `apply_rebase` / `apply_profit_share` so vault state mutates between
trades rather than only after them. The existing one-shot oracle-crash rebase
test is kept intact; this is purely additive helper surface.

A regression test that uses both new params end-to-end is checked in as
`it.skip`: `Vault profit share is consistent under gradual equity gain` in
`TestTokenizedDriftVaults` (commented at the call site). It opens a 1x
SOL-PERP long, then runs 30 iters of round-trip trades with a +1% oracle
nudge per iter and `apply_profit_share` + `validateTotalUserShares` every 4
iters, asserting profit-share reduces vd0's shares mid-loop. Bias is UP
because drift's maintenance-margin auto-liquidation and
`Vault::calculate_equity`'s `InvalidEquityValue` (negative equity) guard
both fire well before a gradual drain could land equity in the rebase
window.

Why skipped: the test trips drift's
`validate_fill_price_within_price_bands` (`programs/drift/src/math/orders.rs:511`)
on the first `placeAndTakePerpOrder` after the preceding
`Disallow tokenize after vault rebases` test. That test crashes the SOL
oracle, which drags the perp market's internal
`historical_oracle_data.last_oracle_price_twap_5min` along with it. That
field isn't settable from outside the program — `setFeedPrice` only updates
the Pyth feed, not the perp market's cached 5-min TWAP — so even after the
start-of-test restore, the cached TWAP stays near the crashed price and any
reasonable fill at the restored oracle diverges past drift's 50% TWAP band
and gets rejected. Reordering this test to run *before* the rebase test
was tried but regressed the rebase test: when the gradual-gain test fails,
its `mmDriftClient` stays subscribed with stale MM orders and the next test
sees a polluted market state. To unblock, one of: (a) shadow exposes a
test-only setter for the perp-market 5-min TWAP (or relaxes the band check
under a test feature gate), (b) spot DLOB returns so this test can use
SOL-spot's separate TWAP path, or (c) restructure into a wholly separate
test file that brings up its own validator-genesis perp market with a clean
TWAP.

### 3. Spot DLOB matching itself

`placeAndTakeSpotOrder`, `placeAndMakeSpotOrder`, MM crossing spot orders,
spot fulfillment configs, etc. — all permanently stubbed to throw in shadow.
Not testable today by design.

**No action needed unless shadow re-enables the spot DLOB.** If it does, the
helper changes are reversible: `initializeSolSpotMarketMaker` and
`doWashTrading` both accept a `marketType` / `mmMarketType` parameter — pass
`MarketType.SPOT` to flip back to spot quoting. The spot branches in
`doWashTrading` were preserved (they handle `placeAndTakeSpotOrder`'s different
arg shape: `fulfillmentConfig` at index 1, `makerInfo` at index 2 — vs perp's
`makerInfo` at index 1).

## Pointers for the picker-up

- The four rewritten tests are in `tests/driftVaults.ts` (search for
  "Disallow tokenize after vault rebases" and "Redeem vault tokens with profit
  share").
- The dynamic oracle target for the rebase test is at the
  `Disallow tokenize after vault rebases` test, around the comment
  "Compute the oracle target dynamically from the actual filled position".
  Equity must land in `(0, total_shares/100]` (≈ `(0, $10]` for a $1000
  initial deposit) for the first rebase to fire. The math:

  ```
  entry_price_units = quote_amount × BASE_PRECISION × PRICE_PRECISION /
                      (base_amount × QUOTE_PRECISION)
  oracleΔ          = (targetEquity − usdcBalance) × BASE_PRECISION × PRICE_PRECISION /
                      (base_amount × QUOTE_PRECISION)
  newOracle        = entry_price_units + oracleΔ
  ```

  If you change leverage in `longBaseAmount`, the equity-vs-oracle slope shifts
  and the oracle window narrows; the dynamic calc will follow but you may
  trip drift's `too_volatile_ratio = 5` (default state guard rail —
  `programs/drift/src/state/state.rs` in shadow). Keep oracle within
  `[twap/5, twap×5]`.

- The rebase suite's `afterAll` restores the SOL oracle to
  `initialSolPerpPrice` so the crashed price doesn't leak to subsequent
  describe blocks (`TestWithdrawFromVaults`, etc.). Don't remove this —
  `Test manager cancel withdraw owning 100% of vault` started failing once
  before this was added.

- `programs/drift_vaults/src/state/vault.rs:499` (`InvalidEquityValue`) is the
  guard that vetoes negative `vault_equity`. Drift's `vault_equity` is `i128`
  (see `calculate_user_equity` in `programs/drift/src/math/margin.rs`); going
  negative there means `vault.calculate_equity` errors out before
  `apply_rebase` even runs. The dynamic oracle target is sized to land
  positive but small — be careful if you tweak it.

- For future debugging, the loop in `doWashTrading` swallows errors via
  `assert(false, ...)` only when `i < 5`. To trace what drift is actually
  rejecting on iter 1, drop a `console.log(e.logs ?? e)` before the assert in
  `tests/common/testHelpers.ts`.
