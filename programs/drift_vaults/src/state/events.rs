use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

#[event]
#[derive(Default)]
pub struct VaultRecord {
    pub ts: i64,
    pub spot_market_index: u16,
    pub vault_equity_before: u64,
}

#[event]
#[derive(Default)]
pub struct VaultDepositorRecord {
    pub ts: i64,
    pub vault: Pubkey,
    pub depositor_authority: Pubkey,
    pub action: VaultDepositorAction,
    pub amount: u64,

    pub spot_market_index: u16,
    pub vault_shares_before: u128,
    pub vault_shares_after: u128,

    pub vault_equity_before: u64,

    pub user_vault_shares_before: u128,
    pub total_vault_shares_before: u128,

    pub user_vault_shares_after: u128,
    pub total_vault_shares_after: u128,

    pub profit_share: u64,
    pub management_fee: i64,
    pub management_fee_shares: i64,

    /// precision: PRICE_PRECISION
    pub deposit_oracle_price: i64,
}

#[event]
#[derive(Default)]
pub struct VaultDepositorV1Record {
    pub ts: i64,
    pub vault: Pubkey,
    pub depositor_authority: Pubkey,
    pub action: VaultDepositorAction,
    pub amount: u64,

    pub spot_market_index: u16,
    pub vault_shares_before: u128,
    pub vault_shares_after: u128,

    pub vault_equity_before: u64,

    pub user_vault_shares_before: u128,
    pub total_vault_shares_before: u128,

    pub user_vault_shares_after: u128,
    pub total_vault_shares_after: u128,

    pub protocol_shares_before: u128,
    pub protocol_shares_after: u128,

    pub protocol_profit_share: u64,
    pub protocol_fee: i64,
    pub protocol_fee_shares: i64,

    pub manager_profit_share: u64,
    pub management_fee: i64,
    pub management_fee_shares: i64,

    /// precision: PRICE_PRECISION
    pub deposit_oracle_price: i64,
}

#[derive(Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq, Default)]
pub enum VaultDepositorAction {
    #[default]
    Deposit,
    WithdrawRequest,
    CancelWithdrawRequest,
    Withdraw,
    FeePayment,
    TokenizeShares,
    RedeemTokens,
}

#[event]
#[derive(Default)]
pub struct ShareTransferRecord {
    pub ts: i64,
    pub vault: Pubkey,
    pub from_vault_depositor: Pubkey,
    pub to_vault_depositor: Pubkey,
    pub shares: u128,
    pub value: u64,
    pub from_depositor_shares_before: u128,
    pub from_depositor_shares_after: u128,
    pub to_depositor_shares_before: u128,
    pub to_depositor_shares_after: u128,
}

#[event]
pub struct FuelSeasonRecord {
    pub ts: i64,
    pub authority: Pubkey,
    pub fuel_insurance: u128,
    pub fuel_deposits: u128,
    pub fuel_borrows: u128,
    pub fuel_positions: u128,
    pub fuel_taker: u128,
    pub fuel_maker: u128,
    pub fuel_total: u128,
}

#[derive(Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum FeeUpdateAction {
    PendingFeeUpdate,
    AppliedFeeUpdate,
}

#[event]
pub struct FeeUpdateRecord {
    pub ts: i64,
    pub action: FeeUpdateAction,
    pub update_in_effect_ts: i64,
    pub vault: Pubkey,
    pub old_management_fee: i64,
    pub old_profit_share: u32,
    pub old_hurdle_rate: u32,
    pub new_management_fee: i64,
    pub new_profit_share: u32,
    pub new_hurdle_rate: u32,
}
