use crate::error::{ErrorCode, VaultResult};
use crate::Size;
use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};
use drift::controller::spot_balance::update_spot_balances;
use drift::error::{DriftResult, ErrorCode as DriftErrorCode};

use drift::math::constants::PERCENTAGE_PRECISION;

use crate::state::vault::Vault;
use crate::validate;
use static_assertions::const_assert_eq;

use crate::events::{VaultDepositorAction, VaultDepositorRecord};

use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};

use drift::math::casting::Cast;
use drift::math::margin::meets_initial_margin_requirement;
use drift::math::safe_math::SafeMath;
use drift::state::oracle_map::OracleMap;
use drift::state::perp_market_map::PerpMarketMap;
use drift::state::spot_market::SpotBalanceType;
use drift::state::spot_market_map::SpotMarketMap;
use drift::state::user::User;

#[account(zero_copy)]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct VaultDepositor {
    /// The vault deposited into
    pub vault: Pubkey,
    /// The vault depositor account's pubkey. It is a pda of vault and authority
    pub pubkey: Pubkey,
    /// The authority is the address w permission to deposit/withdraw
    pub authority: Pubkey,
    /// share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity
    vault_shares: u128,
    /// requested vault shares for withdraw
    pub last_withdraw_request_shares: u128,
    /// requested value (in vault spot_market_index) of shares for withdraw
    pub last_withdraw_request_value: u64,
    /// request ts of vault withdraw
    pub last_withdraw_request_ts: i64,
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
    /// the exponent for vault_shares decimal places
    pub vault_shares_base: u32,
    pub padding: [u8; 32],
}

impl Size for VaultDepositor {
    const SIZE: usize = 224 + 8;
}

const_assert_eq!(
    VaultDepositor::SIZE,
    std::mem::size_of::<VaultDepositor>() + 8
);

impl VaultDepositor {
    pub fn new(vault: Pubkey, pubkey: Pubkey, authority: Pubkey, now: i64) -> Self {
        VaultDepositor {
            vault,
            pubkey,
            authority,
            vault_shares: 0,
            vault_shares_base: 0,
            last_withdraw_request_value: 0,
            last_withdraw_request_shares: 0,
            last_withdraw_request_ts: 0,
            last_valid_ts: now,
            net_deposits: 0,
            total_deposits: 0,
            total_withdraws: 0,
            cumulative_profit_share_amount: 0,
            padding: [0u8; 32],
        }
    }

    fn validate_base(&self, vault: &Vault) -> Result<()> {
        validate!(
            self.vault_shares_base == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor bases mismatch. user base: {} vault base {}",
            self.vault_shares_base,
            vault.shares_base
        )?;

        Ok(())
    }

    pub fn checked_vault_shares(&self, vault: &Vault) -> Result<u128> {
        self.validate_base(vault)?;
        Ok(self.vault_shares)
    }

    pub fn unchecked_vault_shares(&self) -> u128 {
        self.vault_shares
    }

    pub fn increase_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = self.vault_shares.safe_add(delta)?;
        Ok(())
    }

    pub fn decrease_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = self.vault_shares.safe_sub(delta)?;
        Ok(())
    }

    pub fn update_vault_shares(&mut self, new_shares: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = new_shares;

        Ok(())
    }

    pub fn has_pending_withdraw_request(&self) -> bool {
        self.last_withdraw_request_value != 0 || self.last_withdraw_request_shares != 0
    }

    pub fn apply_rebase(
        self: &mut VaultDepositor,
        vault: &mut Vault,
        vault_equity: u64,
    ) -> Result<()> {
        vault.apply_rebase(vault_equity)?;

        if vault.shares_base != self.vault_shares_base {
            validate!(
                vault.shares_base > self.vault_shares_base,
                ErrorCode::InvalidVaultRebase,
                "Rebase expo out of bounds"
            )?;

            let expo_diff = (vault.shares_base - self.vault_shares_base).cast::<u32>()?;

            let rebase_divisor = 10_u128.pow(expo_diff);

            msg!(
                "rebasing vault depositor: base: {} -> {} ",
                self.vault_shares_base,
                vault.shares_base,
            );

            self.vault_shares_base = vault.shares_base;

            let old_vault_shares = self.unchecked_vault_shares();
            let new_vault_shares = old_vault_shares.safe_div(rebase_divisor)?;

            msg!("rebasing vault depositor: shares -> {} ", new_vault_shares);

            self.update_vault_shares(new_vault_shares, vault)?;

            self.last_withdraw_request_shares =
                self.last_withdraw_request_shares.safe_div(rebase_divisor)?;
        }

        validate!(
            self.vault_shares_base == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor shares_base != vault shares_base"
        )?;

        Ok(())
    }

    pub fn calculate_vault_shares_lost(
        self: &VaultDepositor,
        vault: &Vault,
        vault_equity: u64,
    ) -> Result<u128> {
        let n_shares = self.last_withdraw_request_shares;

        let amount = depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?;

        let vault_shares_lost = if amount > self.last_withdraw_request_value {
            let new_n_shares = vault_amount_to_depositor_shares(
                self.last_withdraw_request_value,
                vault.total_shares.safe_sub(n_shares)?,
                vault_equity.safe_sub(self.last_withdraw_request_value)?,
            )?;

            validate!(
                new_n_shares <= n_shares,
                ErrorCode::InvalidVaultSharesDetected,
                "Issue calculating delta if_shares after canceling request {} < {}",
                new_n_shares,
                n_shares
            )?;

            n_shares.safe_sub(new_n_shares)?
        } else {
            0
        };

        Ok(vault_shares_lost)
    }

    pub fn calculate_profit_share_and_update(
        self: &mut VaultDepositor,
        total_amount: u64,
        vault: &Vault,
    ) -> Result<u128> {
        let profit = total_amount.cast::<i64>()?.safe_sub(
            self.net_deposits
                .safe_add(self.cumulative_profit_share_amount)?,
        )?;
        if profit > 0 {
            let profit_u128 = profit.cast::<u128>()?;

            let profit_share_amount = profit_u128
                .safe_mul(vault.profit_share.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?;

            self.cumulative_profit_share_amount = self
                .cumulative_profit_share_amount
                .safe_add(profit_u128.cast()?)?;

            return Ok(profit_share_amount);
        }

        Ok(0)
    }

    pub fn set_withdraw_request(
        self: &mut VaultDepositor,
        vault: &mut Vault,
        withdraw_shares: u128,
        withdraw_value: u64,
        vault_equity: u64,
        now: i64,
    ) -> Result<()> {
        validate!(
            self.last_withdraw_request_shares == 0,
            ErrorCode::VaultWithdrawRequestInProgress,
            "Vault withdraw request is already in progress"
        )?;

        validate!(
            withdraw_shares <= self.checked_vault_shares(vault)?,
            ErrorCode::InvalidVaultWithdrawSize,
            "shares requested exceeds vault_shares {} > {}",
            withdraw_shares,
            self.checked_vault_shares(vault)?
        )?;

        self.last_withdraw_request_shares = withdraw_shares;

        validate!(
            withdraw_value == 0 || withdraw_value <= vault_equity,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested withdraw value {} is not equal or below vault_equity {}",
            withdraw_value,
            vault_equity
        )?;

        self.last_withdraw_request_value = withdraw_value;

        self.last_withdraw_request_ts = now;

        vault.total_withdraw_requested = vault.total_withdraw_requested.safe_add(withdraw_value)?;

        Ok(())
    }

    pub fn reset_withdraw_request(
        self: &mut VaultDepositor,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        // reset vault withdraw request info
        vault.total_withdraw_requested = vault
            .total_withdraw_requested
            .safe_sub(self.last_withdraw_request_value)?;

        // reset vault_depositor withdraw request info
        self.last_withdraw_request_shares = 0;
        self.last_withdraw_request_value = 0;
        self.last_withdraw_request_ts = now;

        Ok(())
    }

    pub fn deposit(
        self: &mut VaultDepositor,
        amount: u64,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        validate!(
            vault.max_tokens == 0 || vault.max_tokens > vault_equity.safe_add(amount)?,
            ErrorCode::VaultIsAtCapacity,
            "after deposit vault equity is {} > {}",
            vault_equity.safe_add(amount)?,
            vault.max_tokens
        )?;

        validate!(
            vault.min_deposit_amount == 0 || amount >= vault.min_deposit_amount,
            ErrorCode::InvalidVaultDeposit,
            "deposit amount {} is below vault min_deposit_amount {}",
            amount,
            vault.min_deposit_amount
        )?;

        validate!(
            !(vault_equity == 0 && vault.total_shares != 0),
            ErrorCode::InvalidVaultForNewDepositors,
            "Vault balance should be non-zero for new depositors to enter"
        )?;

        validate!(
            !self.has_pending_withdraw_request(),
            ErrorCode::WithdrawInProgress,
            "withdraw request is in progress"
        )?;

        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;
        let profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;

        let n_shares = vault_amount_to_depositor_shares(amount, vault.total_shares, vault_equity)?;

        self.total_deposits = self.total_deposits.saturating_add(amount);
        vault.total_deposits = vault.total_deposits.saturating_add(amount);
        self.net_deposits = self.net_deposits.safe_add(amount.cast()?)?;
        vault.net_deposits = vault.net_deposits.safe_add(amount.cast()?)?;

        self.increase_vault_shares(n_shares, vault)?;

        vault.total_shares = vault.total_shares.safe_add(n_shares)?;

        vault.user_shares = vault.user_shares.safe_add(n_shares)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;
        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Deposit,
            amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        Ok(())
    }

    pub fn request_withdraw(
        self: &mut VaultDepositor,
        withdraw_amount: u128,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        self.apply_rebase(vault, vault_equity)?;
        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;
        let profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;

        let (withdraw_value, n_shares) = match withdraw_unit {
            WithdrawUnit::Token => {
                let withdraw_value: u64 = withdraw_amount.cast()?;
                let n_shares: u128 = vault_amount_to_depositor_shares(
                    withdraw_value,
                    vault.total_shares,
                    vault_equity,
                )?;
                (withdraw_value, n_shares)
            }
            WithdrawUnit::Shares => {
                let n_shares: u128 = withdraw_amount;
                let withdraw_value: u64 =
                    depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?
                        .min(vault_equity);
                (withdraw_value, n_shares)
            }
            WithdrawUnit::SharesPercent => {
                let n_shares =
                    WithdrawUnit::get_shares_from_percent(withdraw_amount, self.vault_shares)?;
                let withdraw_value: u64 =
                    depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?
                        .min(vault_equity);
                (withdraw_value, n_shares)
            }
        };

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested n_shares = 0"
        )?;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        self.set_withdraw_request(vault, n_shares, withdraw_value, vault_equity, now)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::WithdrawRequest,
            amount: self.last_withdraw_request_value,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        Ok(())
    }

    pub fn cancel_withdraw_request(
        self: &mut VaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;
        let profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;

        let vault_shares_lost = self.calculate_vault_shares_lost(vault, vault_equity)?;
        self.decrease_vault_shares(vault_shares_lost, vault)?;

        vault.total_shares = vault.total_shares.safe_sub(vault_shares_lost)?;

        vault.user_shares = vault.user_shares.safe_sub(vault_shares_lost)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::CancelWithdrawRequest,
            amount: 0,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        self.reset_withdraw_request(vault, now)?;

        Ok(())
    }

    pub fn withdraw(
        self: &mut VaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<(u64, bool)> {
        self.check_redeem_period_finished(vault, now)?;

        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let n_shares = self.last_withdraw_request_shares;

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdraw,
            "Must submit withdraw request and wait the redeem_period ({} seconds)",
            vault.redeem_period
        )?;

        validate!(
            vault_shares_before >= n_shares,
            ErrorCode::InsufficientVaultShares
        )?;

        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;
        msg!("after management_fee vault_shares={}", self.vault_shares,);

        let profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;
        msg!("after profit_share vault_shares={}", self.vault_shares,);
        let amount: u64 =
            depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?;

        let withdraw_amount = amount.min(self.last_withdraw_request_value);
        msg!(
            "amount={}, last_withdraw_request_value={}",
            amount,
            self.last_withdraw_request_value
        );
        msg!(
            "vault_shares={}, last_withdraw_request_shares={}",
            self.vault_shares,
            self.last_withdraw_request_shares
        );
        self.decrease_vault_shares(n_shares, vault)?;

        self.total_withdraws = self.total_withdraws.saturating_add(withdraw_amount);
        vault.total_withdraws = vault.total_withdraws.saturating_add(withdraw_amount);
        self.net_deposits = self.net_deposits.safe_sub(withdraw_amount.cast()?)?;
        vault.net_deposits = vault.net_deposits.safe_sub(withdraw_amount.cast()?)?;

        vault.total_shares = vault.total_shares.safe_sub(n_shares)?;

        vault.user_shares = vault.user_shares.safe_sub(n_shares)?;

        self.reset_withdraw_request(vault, now)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Withdraw,
            amount: withdraw_amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        let finishing_liquidation = vault.liquidation_delegate == self.authority;

        Ok((withdraw_amount, finishing_liquidation))
    }

    pub fn apply_profit_share(
        self: &mut VaultDepositor,
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

    pub fn realize_profits(
        self: &mut VaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<u64> {
        let (management_fee, management_fee_shares) =
            vault.apply_management_fee(vault_equity, now)?;

        let vault_shares_before = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let profit_share = self.apply_profit_share(vault_equity, vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::FeePayment,
            amount: 0,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after: self.vault_shares,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee,
            management_fee_shares,
        });

        Ok(profit_share)
    }

    pub fn check_redeem_period_finished(&self, vault: &Vault, now: i64) -> Result<()> {
        let time_since_withdraw_request = now.safe_sub(self.last_withdraw_request_ts)?;

        validate!(
            time_since_withdraw_request >= vault.redeem_period,
            ErrorCode::CannotWithdrawBeforeRedeemPeriodEnd
        )?;

        Ok(())
    }

    pub fn check_cant_withdraw(
        &self,
        vault: &Vault,
        drift_user: &mut User,
        perp_market_map: &PerpMarketMap,
        spot_market_map: &SpotMarketMap,
        oracle_map: &mut OracleMap,
    ) -> DriftResult {
        let mut spot_market = spot_market_map.get_ref_mut(&vault.spot_market_index)?;

        update_spot_balances(
            self.last_withdraw_request_value.cast()?,
            &SpotBalanceType::Borrow,
            &mut spot_market,
            drift_user.force_get_spot_position_mut(vault.spot_market_index)?,
            true,
        )?;

        drop(spot_market);

        let can_withdraw = meets_initial_margin_requirement(
            drift_user,
            perp_market_map,
            spot_market_map,
            oracle_map,
        )?;

        if can_withdraw {
            msg!("depositor is able to withdraw");
            return Err(DriftErrorCode::DefaultError);
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum WithdrawUnit {
    Shares,
    Token,
    SharesPercent,
}

const MAX_WITHDRAW_PERCENT: u128 = 1_000_000;
impl WithdrawUnit {
    pub fn get_shares_from_percent(percent: u128, shares: u128) -> VaultResult<u128> {
        validate!(
            percent <= MAX_WITHDRAW_PERCENT,
            ErrorCode::SharesPercentTooLarge
        )?;
        let shares = shares.safe_mul(percent)?.safe_div(MAX_WITHDRAW_PERCENT)?;
        Ok(shares)
    }
}

#[cfg(test)]
mod tests {
    use crate::{Vault, VaultDepositor, WithdrawUnit};
    use anchor_lang::prelude::Pubkey;
    use drift::math::casting::Cast;
    use drift::math::constants::{QUOTE_PRECISION, QUOTE_PRECISION_U64};
    use drift::math::insurance::if_shares_to_vault_amount;

    #[test]
    fn base_init() {
        let now = 1337;
        let vd = VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.last_valid_ts, now);
    }

    #[test]
    fn test_deposit_withdraw() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();

        let vault_equity: u64 = 200 * QUOTE_PRECISION_U64;

        vd.request_withdraw(
            amount.cast().unwrap(),
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();

        let (withdraw_amount, _) = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(withdraw_amount, amount);
    }

    #[test]
    fn test_deposit_paritial_withdraw_profit_share() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);

        vault.profit_share = 100000; // 10% profit share
        vault_equity = 400 * QUOTE_PRECISION_U64; // up 100%

        // withdraw principal
        vd.request_withdraw(
            amount.cast().unwrap(),
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 95000000);

        assert_eq!(vd.last_withdraw_request_shares, 50000000);
        assert_eq!(vd.last_withdraw_request_value, 100000000);
        assert_eq!(vd.last_withdraw_request_ts, now + 20);

        let (withdraw_amount, _ll) = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 45000000);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vault.user_shares, 45000000);
        assert_eq!(vault.total_shares, 150000000);
        assert_eq!(withdraw_amount, amount);

        vault_equity -= withdraw_amount;

        let manager_owned_shares = vault.total_shares.checked_sub(vault.user_shares).unwrap();
        let manager_owned_amount =
            if_shares_to_vault_amount(manager_owned_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(manager_owned_amount, 210000000); // $210

        let user_owned_shares = vault.user_shares;
        let user_owned_amount =
            if_shares_to_vault_amount(user_owned_shares, vault.total_shares, vault_equity).unwrap();
        assert_eq!(user_owned_amount, 90000000); // $90
    }

    #[test]
    fn test_deposit_full_withdraw_profit_share() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);

        vault.profit_share = 100000; // 10% profit share
        vault_equity = 400 * QUOTE_PRECISION_U64; // up 100%

        // withdraw all
        vd.request_withdraw(
            190 * QUOTE_PRECISION, // 200 - 10% share
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 95000000);

        assert_eq!(vd.last_withdraw_request_shares, 95000000);
        assert_eq!(vd.last_withdraw_request_value, 190000000);
        assert_eq!(vd.last_withdraw_request_ts, now + 20);

        let (withdraw_amount, _) = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 0);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 105000000);
        assert_eq!(withdraw_amount, amount * 2 - amount * 2 / 20);
        assert_eq!(vd.cumulative_profit_share_amount, 100000000); // $100

        vault_equity -= withdraw_amount;

        let manager_owned_shares = vault.total_shares.checked_sub(vault.user_shares).unwrap();
        let manager_owned_amount =
            if_shares_to_vault_amount(manager_owned_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(manager_owned_amount, 210000000); // $210
    }

    #[test]
    fn test_force_realize_profit_share() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);

        vault.profit_share = 100000; // 10% profit share
        vault_equity = 400 * QUOTE_PRECISION_U64; // up 100%

        vd.realize_profits(vault_equity, vault, now).unwrap();

        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 95000000);
        assert_eq!(vd.cumulative_profit_share_amount, 100000000); // $100
        assert_eq!(vault.user_shares, 95000000); // $95
        assert_eq!(vault.total_shares, 200000000); // $200

        // withdraw all
        vd.request_withdraw(
            190 * QUOTE_PRECISION,
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 95000000);

        assert_eq!(vd.last_withdraw_request_value, 190000000);
        assert_eq!(vd.last_withdraw_request_ts, now + 20);
        // assert_eq!(vd.last_withdraw_request_shares, 100000000);

        let (withdraw_amount, _ll) = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 0);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 105000000);
        assert_eq!(withdraw_amount, amount * 2 - amount * 2 / 20);
        assert_eq!(vd.cumulative_profit_share_amount, 100000000); // $100
    }
}
