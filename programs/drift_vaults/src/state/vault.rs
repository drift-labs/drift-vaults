use crate::events::{VaultDepositorAction, VaultDepositorRecord};
use crate::{validate, Size, VaultDepositor, WithdrawUnit};

use crate::constants::TIME_FOR_LIQUIDATION;
use crate::error::{ErrorCode, VaultResult};
use crate::state::withdraw_request::WithdrawRequest;
use anchor_lang::prelude::*;
use drift::math::casting::Cast;
use drift::math::constants::{ONE_YEAR, PERCENTAGE_PRECISION, PERCENTAGE_PRECISION_I128};
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
use drift_macros::assert_no_slop;
use static_assertions::const_assert_eq;

#[assert_no_slop]
#[account(zero_copy(unsafe))]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct Vault {
    /// The name of the vault. Vault pubkey is derived from this name.
    pub name: [u8; 32],
    /// The vault's pubkey. It is a pda of name and also used as the authority for drift user
    pub pubkey: Pubkey,
    /// The manager of the vault who has ability to update vault params
    pub manager: Pubkey,
    /// The vaults token account. Used to receive tokens between deposits and withdrawals
    pub token_account: Pubkey,
    /// The drift user stats account for the vault
    pub user_stats: Pubkey,
    /// The drift user account for the vault
    pub user: Pubkey,
    /// The vaults designated delegate for drift user account
    /// Can differ from actual user delegate if vault is in liquidation
    pub delegate: Pubkey,
    /// The delegate handling liquidation for depositor
    pub liquidation_delegate: Pubkey,
    /// the sum of all shares held by the users (vault depositors)
    pub user_shares: u128,
    /// the sum of all shares (including vault manager)
    pub total_shares: u128,
    /// last fee update unix timestamp
    pub last_fee_update_ts: i64,
    /// When the liquidation start
    pub liquidation_start_ts: i64,
    /// the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw
    pub redeem_period: i64,
    /// the sum of all outstanding withdraw requests
    pub total_withdraw_requested: u64,
    /// max token capacity, once hit/passed vault will reject new deposits (updateable)
    pub max_tokens: u64,
    /// manager fee
    pub management_fee: i64,
    /// timestamp vault initialized
    pub init_ts: i64,
    /// the net deposits for the vault
    pub net_deposits: i64,
    /// the net deposits for the vault manager
    pub manager_net_deposits: i64,
    /// total deposits
    pub total_deposits: u64,
    /// total withdraws
    pub total_withdraws: u64,
    /// total deposits for the vault manager
    pub manager_total_deposits: u64,
    /// total withdraws for the vault manager
    pub manager_total_withdraws: u64,
    /// total mgmt fee charged by vault manager
    pub manager_total_fee: i64,
    /// total profit share charged by vault manager
    pub manager_total_profit_share: u64,
    /// the minimum deposit amount
    pub min_deposit_amount: u64,
    pub last_manager_withdraw_request: WithdrawRequest,
    /// the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)
    pub shares_base: u32,
    /// percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION
    pub profit_share: u32,
    /// vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION
    pub hurdle_rate: u32, // todo: not implemented yet
    /// The spot market index the vault deposits into/withdraws from
    pub spot_market_index: u16,
    /// The bump for the vault pda
    pub bump: u8,
    /// Whether or not anybody can be a depositor
    pub permissioned: bool,
    pub padding: [u64; 8],
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 528 + 8;
}
const_assert_eq!(Vault::SIZE, std::mem::size_of::<Vault>() + 8);

impl Vault {
    pub fn apply_management_fee(&mut self, vault_equity: u64, now: i64) -> Result<(i64, i64)> {
        let depositor_equity =
            depositor_shares_to_vault_amount(self.user_shares, self.total_shares, vault_equity)?
                .cast::<i128>()?;
        let mut management_fee_payment: i128 = 0;
        let mut management_fee_shares: i128 = 0;
        let mut skip_ts_update = false;

        if self.management_fee != 0 && depositor_equity > 0 {
            let since_last = now.safe_sub(self.last_fee_update_ts)?;

            management_fee_payment = depositor_equity
                .safe_mul(self.management_fee.cast()?)?
                .safe_div(PERCENTAGE_PRECISION_I128)?
                .safe_mul(since_last.cast()?)?
                .safe_div(ONE_YEAR.cast()?)?
                .min(depositor_equity.saturating_sub(1));

            let new_total_shares_factor: u128 = depositor_equity
                .safe_mul(PERCENTAGE_PRECISION_I128)?
                .safe_div(depositor_equity.safe_sub(management_fee_payment)?)?
                .cast()?;

            let new_total_shares = self
                .total_shares
                .safe_mul(new_total_shares_factor.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?
                .max(self.user_shares);

            if management_fee_payment == 0 || self.total_shares == new_total_shares {
                // time delta wasnt large enough to pay any management fee
                skip_ts_update = true;
            }

            management_fee_shares = new_total_shares
                .cast::<i128>()?
                .safe_sub(self.total_shares.cast()?)?;
            self.total_shares = new_total_shares;
            self.manager_total_fee = self
                .manager_total_fee
                .saturating_add(management_fee_payment.cast()?);

            // in case total_shares is pushed to level that warrants a rebase
            self.apply_rebase(vault_equity)?;
        }

        if !skip_ts_update {
            self.last_fee_update_ts = now;
        }

        Ok((
            management_fee_payment.cast::<i64>()?,
            management_fee_shares.cast::<i64>()?,
        ))
    }

    pub fn get_manager_shares(&self) -> VaultResult<u128> {
        let manager_shares = self.total_shares.safe_sub(self.user_shares)?;
        Ok(manager_shares)
    }

    pub fn apply_rebase(&mut self, vault_equity: u64) -> Result<Option<u128>> {
        let mut rebase_divisor = None;
        if vault_equity != 0 && vault_equity.cast::<u128>()? < self.total_shares {
            let (expo_diff, _rebase_divisor) =
                calculate_rebase_info(self.total_shares, vault_equity)?;

            if expo_diff != 0 {
                self.total_shares = self.total_shares.safe_div(_rebase_divisor)?;
                self.user_shares = self.user_shares.safe_div(_rebase_divisor)?;
                self.shares_base = self.shares_base.safe_add(expo_diff)?;

                rebase_divisor = Some(_rebase_divisor);

                msg!("rebasing vault: expo_diff={}", expo_diff);
            }
        }

        if vault_equity != 0 && self.total_shares == 0 {
            self.total_shares = vault_equity.cast::<u128>()?;
        }

        Ok(rebase_divisor)
    }

    /// Returns the equity value of the vault, in the vault's spot market token min precision
    pub fn calculate_equity(
        &self,
        user: &User,
        perp_market_map: &PerpMarketMap,
        spot_market_map: &SpotMarketMap,
        oracle_map: &mut OracleMap,
    ) -> VaultResult<u64> {
        let (vault_equity, all_oracles_valid) =
            calculate_user_equity(user, perp_market_map, spot_market_map, oracle_map)?;

        validate!(
            all_oracles_valid,
            ErrorCode::InvalidEquityValue,
            "oracle invalid"
        )?;
        validate!(
            vault_equity >= 0,
            ErrorCode::InvalidEquityValue,
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
        let (management_fee, management_fee_shares) =
            self.apply_management_fee(vault_equity, now)?;

        let user_vault_shares_before = self.user_shares;
        let total_vault_shares_before = self.total_shares;
        let vault_shares_before = self.total_shares.safe_sub(self.user_shares)?;

        let n_shares =
            vault_amount_to_depositor_shares(amount, total_vault_shares_before, vault_equity)?;

        self.total_deposits = self.total_deposits.saturating_add(amount);
        self.manager_total_deposits = self.manager_total_deposits.saturating_add(amount);
        self.net_deposits = self.net_deposits.safe_add(amount.cast()?)?;
        self.manager_net_deposits = self.manager_net_deposits.safe_add(amount.cast()?)?;

        self.total_shares = self.total_shares.safe_add(n_shares)?;
        let vault_shares_after = self.total_shares.safe_sub(self.user_shares)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.manager,
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
            management_fee_shares,
        });

        Ok(())
    }

    pub fn check_delegate_available_for_liquidation(
        &self,
        vault_depositor: &VaultDepositor,
        now: i64,
    ) -> VaultResult {
        validate!(
            self.liquidation_delegate != vault_depositor.authority,
            ErrorCode::DelegateNotAvailableForLiquidation,
            "liquidation delegate is already vault depositor"
        )?;

        validate!(
            now.saturating_sub(self.liquidation_start_ts) > TIME_FOR_LIQUIDATION,
            ErrorCode::DelegateNotAvailableForLiquidation,
            "vault is already in liquidation"
        )?;

        Ok(())
    }

    pub fn manager_request_withdraw(
        &mut self,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        now: i64,
    ) -> Result<()> {
        let rebase_divisor = self.apply_rebase(vault_equity)?;
        let (management_fee, management_fee_shares) =
            self.apply_management_fee(vault_equity, now)?;

        let vault_shares_before: u128 = self.get_manager_shares()?;

        let (withdraw_value, n_shares) = withdraw_unit.get_withdraw_value_and_shares(
            withdraw_amount,
            vault_equity,
            self.get_manager_shares()?,
            self.total_shares,
            rebase_divisor,
        )?;

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested n_shares = 0"
        )?;

        // let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = self.total_shares;
        let user_vault_shares_before = self.user_shares;

        self.last_manager_withdraw_request.set(
            vault_shares_before,
            n_shares,
            withdraw_value,
            vault_equity,
            now,
        )?;
        self.total_withdraw_requested = self.total_withdraw_requested.safe_add(withdraw_value)?;

        let vault_shares_after: u128 = self.get_manager_shares()?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.manager,
            action: VaultDepositorAction::WithdrawRequest,
            amount: self.last_manager_withdraw_request.value,
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
            management_fee_shares,
        });

        Ok(())
    }

    pub fn manager_cancel_withdraw_request(
        self: &mut Vault,
        vault_equity: u64,
        now: i64,
    ) -> Result<()> {
        self.apply_rebase(vault_equity)?;

        let vault_shares_before: u128 = self.get_manager_shares()?;
        let total_vault_shares_before = self.total_shares;
        let user_vault_shares_before = self.user_shares;

        let (management_fee, management_fee_shares) =
            self.apply_management_fee(vault_equity, now)?;

        let vault_shares_lost = self
            .last_manager_withdraw_request
            .calculate_shares_lost(self, vault_equity)?;

        self.total_shares = self.total_shares.safe_sub(vault_shares_lost)?;

        self.user_shares = self.user_shares.safe_sub(vault_shares_lost)?;

        let vault_shares_after = self.get_manager_shares()?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.manager,
            action: VaultDepositorAction::CancelWithdrawRequest,
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
            management_fee_shares,
        });

        self.total_withdraw_requested = self
            .total_withdraw_requested
            .safe_sub(self.last_manager_withdraw_request.value)?;
        self.last_manager_withdraw_request.reset(now)?;

        Ok(())
    }

    pub fn manager_withdraw(&mut self, vault_equity: u64, now: i64) -> Result<u64> {
        self.last_manager_withdraw_request
            .check_redeem_period_finished(self, now)?;

        self.apply_rebase(vault_equity)?;

        let (management_fee, management_fee_shares) =
            self.apply_management_fee(vault_equity, now)?;

        let vault_shares_before: u128 = self.get_manager_shares()?;
        let total_vault_shares_before = self.total_shares;
        let user_vault_shares_before = self.user_shares;

        let n_shares = self.last_manager_withdraw_request.shares;

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdraw,
            "Must submit withdraw request and wait the redeem_period ({} seconds)",
            self.redeem_period
        )?;

        let amount: u64 =
            depositor_shares_to_vault_amount(n_shares, self.total_shares, vault_equity)?;

        let n_tokens = amount.min(self.last_manager_withdraw_request.value);

        validate!(
            vault_shares_before >= n_shares,
            ErrorCode::InsufficientVaultShares
        )?;

        self.total_withdraws = self.total_withdraws.saturating_add(n_tokens);
        self.manager_total_withdraws = self.manager_total_withdraws.saturating_add(n_tokens);
        self.net_deposits = self.net_deposits.safe_sub(n_tokens.cast()?)?;
        self.manager_net_deposits = self.manager_net_deposits.safe_sub(n_tokens.cast()?)?;

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
            depositor_authority: self.manager,
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
            management_fee_shares,
        });

        self.total_withdraw_requested = self
            .total_withdraw_requested
            .safe_sub(self.last_manager_withdraw_request.value)?;
        self.last_manager_withdraw_request.reset(now)?;

        Ok(n_tokens)
    }

    pub fn in_liquidation(&self) -> bool {
        self.liquidation_delegate != Pubkey::default()
    }

    pub fn check_can_exit_liquidation(&self, now: i64) -> VaultResult {
        validate!(
            now.saturating_sub(self.liquidation_start_ts) > TIME_FOR_LIQUIDATION,
            ErrorCode::VaultInLiquidation,
            "vault is in liquidation"
        )?;

        Ok(())
    }

    pub fn set_liquidation_delegate(&mut self, liquidation_delegate: Pubkey, now: i64) {
        self.liquidation_delegate = liquidation_delegate;
        self.liquidation_start_ts = now;
    }

    pub fn reset_liquidation_delegate(&mut self) {
        self.liquidation_delegate = Pubkey::default();
        self.liquidation_start_ts = 0;
    }
}
