use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

#[event]
#[derive(Default)]
pub struct VaultRecord {
    pub ts: i64,
    pub spot_market_index: u16,
    pub vault_amount_before: u64,
}

#[event]
#[derive(Default)]
pub struct VaultDepositorRecord {
    pub ts: i64,
    pub vault: Pubkey,
    pub user_authority: Pubkey,
    pub action: VaultDepositorAction,
    pub amount: u64,

    pub spot_market_index: u16,
    pub vault_shares_before: u128,
    pub vault_amount_before: u64,
}

#[derive(Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum VaultDepositorAction {
    Deposit,
    WithdrawRequest,
    CancelWithdrawRequest,
    Withdraw,
}

impl Default for VaultDepositorAction {
    fn default() -> Self {
        VaultDepositorAction::Deposit
    }
}
