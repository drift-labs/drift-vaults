use crate::error::ErrorCode;
use crate::events::{ShareTransferRecord, VaultDepositorAction, VaultDepositorRecord};
use crate::state::vault::Vault;
use crate::validate;
use crate::{Size, VaultDepositorBase};
use static_assertions::const_assert_eq;

use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use drift::math::casting::Cast;
use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};
use drift::math::safe_math::SafeMath;
use drift_macros::assert_no_slop;

#[assert_no_slop]
#[account(zero_copy(unsafe))]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct TokenizedVaultDepositor {
    /// The vault deposited into
    pub vault: Pubkey, // 32
    /// The vault depositor account's pubkey. It is a pda of vault
    pub pubkey: Pubkey, // 32
    /// The token mint for tokenized shares owned by this VaultDepositor
    pub mint: Pubkey, // 32
    /// share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity
    vault_shares: u128, // 16
    last_vault_shares: u128, // 16
    /// creation ts of vault depositor
    pub last_valid_ts: i64, // 8
    /// lifetime net deposits of vault depositor for the vault
    pub net_deposits: i64, // 8

    /// lifetime total deposits
    pub total_deposits: u64, // 8
    /// lifetime total withdraws
    pub total_withdraws: u64, // 8
    /// the token amount of gains the vault depositor has paid performance fees on
    pub cumulative_profit_share_amount: i64, // 8
    pub profit_share_fee_paid: u64, // 8
    /// the exponent for vault_shares decimal places
    pub vault_shares_base: u32, // 4
    /// The bump for the vault pda
    pub bump: u8, // 1
    pub padding: [u8; 3],           // 3
}

impl Size for TokenizedVaultDepositor {
    const SIZE: usize = 184 + 8;
}

const_assert_eq!(
    TokenizedVaultDepositor::SIZE,
    std::mem::size_of::<TokenizedVaultDepositor>() + 8
);

impl VaultDepositorBase for TokenizedVaultDepositor {
    fn get_pubkey(&self) -> Pubkey {
        self.pubkey
    }

    fn get_vault_shares(&self) -> u128 {
        self.vault_shares
    }
    fn set_vault_shares(&mut self, shares: u128) {
        self.vault_shares = shares;
    }

    fn get_vault_shares_base(&self) -> u32 {
        self.vault_shares_base
    }
    fn set_vault_shares_base(&mut self, base: u32) {
        self.vault_shares_base = base;
    }

    fn get_net_deposits(&self) -> i64 {
        self.net_deposits
    }
    fn set_net_deposits(&mut self, amount: i64) {
        self.net_deposits = amount;
    }

    fn get_cumulative_profit_share_amount(&self) -> i64 {
        self.cumulative_profit_share_amount
    }
    fn set_cumulative_profit_share_amount(&mut self, amount: i64) {
        self.cumulative_profit_share_amount = amount;
    }

    fn get_profit_share_fee_paid(&self) -> u64 {
        self.profit_share_fee_paid
    }
    fn set_profit_share_fee_paid(&mut self, amount: u64) {
        self.profit_share_fee_paid = amount;
    }
}

impl TokenizedVaultDepositor {
    pub fn new(vault: Pubkey, pubkey: Pubkey, mint: Pubkey, now: i64) -> Self {
        Self {
            vault,
            pubkey,
            mint,
            vault_shares: 0,
            last_vault_shares: 0,
            last_valid_ts: now,
            net_deposits: 0,
            total_deposits: 0,
            total_withdraws: 0,
            cumulative_profit_share_amount: 0,
            profit_share_fee_paid: 0,
            vault_shares_base: 0,
            bump: 0,
            padding: [0; 3],
        }
    }

    pub fn apply_profit_share(
        self: &mut TokenizedVaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
    ) -> Result<u64> {
        let total_amount =
            depositor_shares_to_vault_amount(self.vault_shares, vault.total_shares, vault_equity)?;

        let profit_share: u64 = self
            .calculate_profit_share_and_update(total_amount, vault)?
            .cast()?;

        let profit_share_shares: u128 =
            vault_amount_to_depositor_shares(profit_share, vault.total_shares, vault_equity)?;

        self.decrease_vault_shares(profit_share_shares, vault)?;

        vault.user_shares = vault.user_shares.safe_sub(profit_share_shares)?;

        vault.manager_total_profit_share = vault
            .manager_total_profit_share
            .saturating_add(profit_share);

        Ok(profit_share)
    }

    pub fn process_tokenized_shares(
        self: &mut TokenizedVaultDepositor,
        vault: &mut Vault,
        mint_supply: u64,
        vault_equity: u64,
        shares_transferred: u128,
        now: i64,
    ) -> Result<u64> {
        self.apply_rebase(vault, vault_equity)?;

        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;
        let profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;

        let vault_shares_before = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        // TODO: do things

        let new_last_vault_shares = self
            .last_vault_shares
            .checked_add(shares_transferred)
            .expect("math");

        validate!(
            new_last_vault_shares == vault_shares_before,
            ErrorCode::InvalidVaultSharesDetected,
            "TokenizedVaultDepositor: last_vault_shares + shares_transferred != vault_shares"
        );

        let tokens_to_mint = vault_amount_to_depositor_shares(
            shares_transferred.cast()?,
            mint_supply.cast()?,
            self.last_vault_shares.cast()?,
        )?;

        msg!(
            "shares_transferred: {}, total_shares_before: {}, token_supply_before: {}, tokens_to_mint: {}",
            shares_transferred,
            self.last_vault_shares,
            mint_supply,
            tokens_to_mint
        );

        self.last_vault_shares = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: vault.pubkey,
            action: VaultDepositorAction::FeePayment,
            amount: 0,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after: self.last_vault_shares,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        Ok(tokens_to_mint.cast()?)
    }
}

#[cfg(test)]
mod tests {
    use crate::{TokenizedVaultDepositor, Vault, WithdrawUnit};
    use anchor_lang::prelude::Pubkey;
    use drift::math::casting::Cast;
    use drift::math::constants::{PERCENTAGE_PRECISION_U64, QUOTE_PRECISION_U64};
    use drift::math::insurance::if_shares_to_vault_amount;

    fn base_init() {
        let now = 1337;
        let mut vd = TokenizedVaultDepositor::new(
            Pubkey::default(),
            Pubkey::default(),
            Pubkey::default(),
            now,
        );
        vd.vault_shares = 123;
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.vault_shares, 123);
    }

    #[test]
    fn test_tokenize_shares() {
        let now = 1337;
        let vault = &mut Vault::default();
        let mut tvd = TokenizedVaultDepositor::new(
            Pubkey::default(),
            Pubkey::default(),
            Pubkey::default(),
            now,
        );
        let mut shares_transferred = 100_000;
        tvd.vault_shares = tvd.last_vault_shares + shares_transferred;

        assert_eq!(tvd.last_vault_shares, 0);

        let mut total_supply = 0;
        let vault_equity = 1_000_000;
        let tokens_issued_1 = tvd
            .process_tokenized_shares(vault, total_supply, vault_equity, shares_transferred, now)
            .unwrap();

        // first tokenization will issue same amount of tokens as shares
        assert_eq!(tokens_issued_1, shares_transferred as u64);
        assert_eq!(tvd.last_vault_shares, tvd.vault_shares);

        // emulate minting tokens
        total_supply += tokens_issued_1;

        // second tokenization is double the shares of first issuance``
        shares_transferred *= 2;
        tvd.vault_shares = tvd.last_vault_shares + shares_transferred;

        let tokens_issued_2 = tvd
            .process_tokenized_shares(vault, total_supply, vault_equity, shares_transferred, now)
            .unwrap();

        // first tokenization will issue same amount of tokens as shares
        assert_eq!(tokens_issued_2, (tokens_issued_1 as u64) * 2);
        assert_eq!(tvd.last_vault_shares, tvd.vault_shares);
        assert_eq!(
            tvd.vault_shares,
            (tokens_issued_1 + tokens_issued_2) as u128
        );
    }
}
