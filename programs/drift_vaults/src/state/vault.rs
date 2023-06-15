use crate::error::ErrorCode;
use crate::events::{VaultDepositorAction, VaultDepositorRecord};
use crate::validate;
use crate::Size;
use crate::WithdrawUnit;
use anchor_lang::prelude::*;
use drift::math::casting::Cast;
use drift::math::constants::{ONE_YEAR, PERCENTAGE_PRECISION};
use drift::math::insurance::calculate_rebase_info;
use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};
use drift::math::margin::calculate_user_equity;
use drift::math::safe_math::SafeMath;
use drift::state::oracle_map::OracleMap;
use drift::state::perp_market_map::PerpMarketMap;
use drift::state::spot_market_map::SpotMarketMap;
use drift::state::user::User;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct Vault {
    /// The name of the vault. Vault pubkey is derived from this name.
    pub name: [u8; 32],
    /// The vault's pubkey. It is a pda of name and also used as the authority for drift user
    pub pubkey: Pubkey,
    /// The authority of the vault who has ability to update vault params
    pub authority: Pubkey,
    /// The vaults token account. Used to receive tokens between deposits and withdrawals
    pub token_account: Pubkey,
    /// The drift user stats account for the vault
    pub user_stats: Pubkey,
    /// The drift user account for the vault
    pub user: Pubkey,
    /// The spot market index the vault deposits into/withdraws from
    pub spot_market_index: u16,
    /// The bump for the vault pda
    pub bump: u8,
    pub padding: [u8; 1],
    /// the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw
    pub redeem_period: i64,
    /// the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)  
    pub shares_base: u32,
    /// the sum of all shares held by the users (vault depositors)
    pub user_shares: u128,
    /// the sum of all shares (including vault authority)
    pub total_shares: u128,
    /// last fee update unix timestamp
    pub last_fee_update_ts: i64,
    /// sum of outstanding withdraw request amount (in tokens) of all vault depositors
    pub total_withdraw_requested: u64,
    /// max token capacity, once hit/passed vault will reject new deposits (updateable)
    pub max_tokens: u64,
    /// percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION (frozen)
    pub profit_share: u32,
    /// vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION
    pub hurdle_rate: u32, // todo: not implemented yet (frozen)
    /// annualized vault admin management fee (frozen)
    pub management_fee: u32,
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 288 + 8;
}

const_assert_eq!(Vault::SIZE, std::mem::size_of::<Vault>() + 8);

impl Vault {
    pub fn apply_management_fee(&mut self, vault_equity: u64, now: i64) -> Result<u64> {
        let depositor_equity =
            depositor_shares_to_vault_amount(self.user_shares, self.total_shares, vault_equity)?
                .cast::<u128>()?;
        let mut management_fee_payment: u128 = 0;

        if self.management_fee > 0 && depositor_equity > 0 {
            let since_last = now.safe_sub(self.last_fee_update_ts)?;

            management_fee_payment = depositor_equity
                .safe_mul(self.management_fee.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?
                .safe_mul(since_last.cast()?)?
                .safe_div(ONE_YEAR)?
                .min(depositor_equity.saturating_sub(1));

            let new_total_shares_factor: u128 = depositor_equity
                .cast::<u128>()?
                .safe_mul(PERCENTAGE_PRECISION)?
                .safe_div(
                    depositor_equity
                        .cast::<u128>()?
                        .safe_sub(management_fee_payment)?,
                )?;

            self.total_shares = self
                .total_shares
                .safe_mul(new_total_shares_factor.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?;

            // in case total_shares is pushed to level that warrants a rebase
            self.apply_rebase(vault_equity)?;
        }

        self.last_fee_update_ts = now;
        Ok(management_fee_payment.cast::<u64>()?)
    }

    pub fn apply_rebase(&mut self, vault_equity: u64) -> Result<()> {
        if vault_equity != 0 && vault_equity.cast::<u128>()? < self.total_shares {
            let (expo_diff, rebase_divisor) =
                calculate_rebase_info(self.total_shares, vault_equity)?;

            self.total_shares = self.total_shares.safe_div(rebase_divisor)?;
            self.user_shares = self.user_shares.safe_div(rebase_divisor)?;
            self.shares_base = self.shares_base.safe_add(expo_diff)?;

            msg!("rebasing vault: expo_diff={}", expo_diff);
        }

        if vault_equity != 0 && self.total_shares == 0 {
            self.total_shares = vault_equity.cast::<u128>()?;
        }

        Ok(())
    }

    /// Returns the equity value of the vault, in the vault's spot market token min precision
    pub fn calculate_equity(
        &self,
        user: &User,
        perp_market_map: &PerpMarketMap,
        spot_market_map: &SpotMarketMap,
        oracle_map: &mut OracleMap,
    ) -> Result<u64> {
        let (vault_equity, all_oracles_valid) =
            calculate_user_equity(user, perp_market_map, spot_market_map, oracle_map)?;

        validate!(all_oracles_valid, ErrorCode::Default, "oracle invalid")?;
        validate!(
            vault_equity >= 0,
            ErrorCode::Default,
            "vault equity negative"
        )?;

        let spot_market = spot_market_map.get_ref(&self.spot_market_index)?;
        let spot_market_precision = spot_market.get_precision().cast::<i128>()?;
        let oracle_price = oracle_map
            .get_price_data(&spot_market.oracle)?
            .price
            .cast::<i128>()?;

        Ok(vault_equity
            .safe_mul(spot_market_precision)?
            .safe_div(oracle_price)?
            .cast::<u64>()?)
    }

    pub fn manager_deposit(&mut self, amount: u64, vault_equity: u64, now: i64) -> Result<()> {
        self.apply_rebase(vault_equity)?;
        let management_fee = self.apply_management_fee(vault_equity, now)?;

        let user_vault_shares_before = self.user_shares;
        let total_vault_shares_before = self.total_shares;
        let vault_shares_before = self.total_shares.safe_sub(self.user_shares)?;

        let n_shares =
            vault_amount_to_depositor_shares(amount, total_vault_shares_before, vault_equity)?;

        self.total_shares = self.total_shares.safe_add(n_shares)?;
        let vault_shares_after = self.total_shares.safe_sub(self.user_shares)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Deposit,
            amount: 0,
            spot_market_index: self.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: self.total_shares,
            user_vault_shares_after: self.user_shares,
            profit_share: 0,
            management_fee,
        });

        Ok(())
    }

    pub fn manager_withdraw(
        &mut self,
        withdraw_amount: u128,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        now: i64,
    ) -> Result<u64> {
        self.apply_rebase(vault_equity)?;

        let management_fee = self.apply_management_fee(vault_equity, now)?;

        let (n_tokens, n_shares) = match withdraw_unit {
            WithdrawUnit::Token => {
                let n_tokens: u64 = withdraw_amount.cast()?;
                let n_shares: u128 =
                    vault_amount_to_depositor_shares(n_tokens, self.total_shares, vault_equity)?;
                (n_tokens, n_shares)
            }
            WithdrawUnit::Shares => {
                let n_shares: u128 = withdraw_amount;
                let n_tokens: u64 =
                    depositor_shares_to_vault_amount(n_shares, self.total_shares, vault_equity)?
                        .min(vault_equity);
                (n_tokens, n_shares)
            }
        };

        let user_vault_shares_before = self.user_shares;
        let total_vault_shares_before = self.total_shares;
        let vault_shares_before = self.total_shares.safe_sub(self.user_shares)?;

        validate!(
            vault_shares_before >= n_shares,
            ErrorCode::InvalidVaultWithdrawSize,
            "vault_shares_before={} < n_shares={}",
            vault_shares_before,
            n_shares
        )?;

        self.total_shares = self.total_shares.safe_sub(n_shares)?;
        let vault_shares_after = self.total_shares.safe_sub(self.user_shares)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Withdraw,
            amount: 0,
            spot_market_index: self.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: self.total_shares,
            user_vault_shares_after: self.user_shares,
            profit_share: 0,
            management_fee,
        });

        Ok(n_tokens)
    }
}
