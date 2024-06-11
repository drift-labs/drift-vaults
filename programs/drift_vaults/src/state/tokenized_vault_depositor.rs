use crate::Size;
use static_assertions::const_assert_eq;

use anchor_lang::prelude::*;
use drift_macros::assert_no_slop;

#[assert_no_slop]
#[account(zero_copy(unsafe))]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct TokenizedVaultDepositor {
    /// The vault deposited into
    pub vault: Pubkey,
    /// The vault depositor account's pubkey. It is a pda of vault
    pub pubkey: Pubkey,
    /// The token mint for tokenized shares owned by this VaultDepositor
    pub mint: Pubkey,
    /// share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity
    vault_shares: u128,
    /// creation ts of vault depositor
    pub last_valid_ts: i64,
    /// lifetime net deposits of vault depositor for the vault
    pub net_deposits: i64,
    /// lifetime total deposits
    pub total_deposits: u64,
    /// lifetime total withdraws
    pub total_withdraws: u64,
    /// the token amount of gains the vault depositor has paid performance fees on
    pub cumulative_profit_share_amount: i64,
    pub profit_share_fee_paid: u64,
    /// the exponent for vault_shares decimal places
    pub vault_shares_base: u32,
    pub padding1: u32,
    pub padding: [u64; 8],
}

impl Size for TokenizedVaultDepositor {
    const SIZE: usize = 232 + 8;
}

const_assert_eq!(
    TokenizedVaultDepositor::SIZE,
    std::mem::size_of::<TokenizedVaultDepositor>() + 8
);

