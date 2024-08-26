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
}

#[derive(Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq, Default)]
pub enum VaultDepositorAction {
    #[default]
    Deposit,
    WithdrawRequest,
    CancelWithdrawRequest,
    Withdraw,
    FeePayment,
}
