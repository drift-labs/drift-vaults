use std::cell::RefMut;

use crate::error::ErrorCode;
use crate::events::{ShareTransferRecord, VaultDepositorAction, VaultDepositorRecord};
use crate::state::vault::Vault;
use crate::{validate, VaultFee, VaultProtocol, WithdrawUnit};
use anchor_lang::prelude::*;

use drift::math::casting::Cast;
use drift::math::constants::PERCENTAGE_PRECISION;
use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};
use drift::math::safe_math::SafeMath;

pub trait Size {
    const SIZE: usize;
}

pub trait VaultDepositorBase {
    fn apply_rebase(
        &mut self,
        vault: &mut Vault,
        vault_protocol: &mut Option<RefMut<VaultProtocol>>,
        vault_equity: u64,
    ) -> Result<Option<u128>>;

    fn get_authority(&self) -> Pubkey;
    fn get_pubkey(&self) -> Pubkey;

    fn get_vault_shares(&self) -> u128;
    fn set_vault_shares(&mut self, shares: u128);

    fn get_vault_shares_base(&self) -> u32;
    fn set_vault_shares_base(&mut self, base: u32);

    fn get_net_deposits(&self) -> i64;
    fn set_net_deposits(&mut self, amount: i64);

    fn get_cumulative_profit_share_amount(&self) -> i64;
    fn set_cumulative_profit_share_amount(&mut self, amount: i64);

    fn get_profit_share_fee_paid(&self) -> u64;
    fn set_profit_share_fee_paid(&mut self, amount: u64);

    fn validate_base(&self, vault: &Vault) -> Result<()> {
        validate!(
            self.get_vault_shares_base() == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor bases mismatch. user base: {} vault base {}",
            self.get_vault_shares_base(),
            vault.shares_base
        )?;

        Ok(())
    }

    fn checked_vault_shares(&self, vault: &Vault) -> Result<u128> {
        self.validate_base(vault)?;
        Ok(self.get_vault_shares())
    }

    fn unchecked_vault_shares(&self) -> u128 {
        self.get_vault_shares()
    }

    fn increase_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.set_vault_shares(self.get_vault_shares().safe_add(delta)?);
        Ok(())
    }

    fn decrease_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.set_vault_shares(self.get_vault_shares().safe_sub(delta)?);
        Ok(())
    }

    fn update_vault_shares(&mut self, new_shares: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.set_vault_shares(new_shares);
        Ok(())
    }

    fn calculate_profit_share_and_update(
        &mut self,
        total_amount: u64,
        vault: &Vault,
    ) -> Result<u128> {
        let profit = total_amount.cast::<i64>()?.safe_sub(
            self.get_net_deposits()
                .safe_add(self.get_cumulative_profit_share_amount())?,
        )?;
        if profit > 0 {
            let profit_u128 = profit.cast::<u128>()?;

            let profit_share_amount = profit_u128
                .safe_mul(vault.profit_share.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?;

            self.set_cumulative_profit_share_amount(
                self.get_cumulative_profit_share_amount()
                    .safe_add(profit_u128.cast()?)?,
            );

            self.set_profit_share_fee_paid(
                self.get_profit_share_fee_paid()
                    .safe_add(profit_share_amount.cast()?)?,
            );

            return Ok(profit_share_amount);
        }

        Ok(0)
    }

    fn apply_profit_share(&mut self, vault_equity: u64, vault: &mut Vault) -> Result<u64> {
        let total_amount = depositor_shares_to_vault_amount(
            self.get_vault_shares(),
            vault.total_shares,
            vault_equity,
        )?;

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

    /// Transfer shares from `self` to `to`
    ///
    /// Returns the number of shares transferred
    fn transfer_shares<'a>(
        &mut self,
        to: &mut dyn VaultDepositorBase,
        vault: &mut Vault,
        vault_protocol: &mut Option<RefMut<'a, VaultProtocol>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        now: i64,
    ) -> Result<(u128, Option<RefMut<'a, VaultProtocol>>)> {
        let from_rebase_divisor = self.apply_rebase(vault, vault_protocol, vault_equity)?;
        let to_rebase_divisor = to.apply_rebase(vault, vault_protocol, vault_equity)?;

        validate!(
            from_rebase_divisor == to_rebase_divisor,
            ErrorCode::InvalidVaultRebase,
            "from and to vault depositors rebase divisors mismatch"
        )?;

        let VaultFee {
            management_fee_payment,
            management_fee_shares,
            protocol_fee_payment: _protocol_fee_payment,
            protocol_fee_shares: _protocol_fee_shares,
        } = vault.apply_fee(vault_protocol, vault_equity, now)?;

        let from_profit_share: u64 = self.apply_profit_share(vault_equity, vault)?;
        let to_profit_share: u64 = to.apply_profit_share(vault_equity, vault)?;

        let (withdraw_value, n_shares) = withdraw_unit.get_withdraw_value_and_shares(
            withdraw_amount,
            vault_equity,
            self.get_vault_shares(),
            vault.total_shares,
            from_rebase_divisor,
        )?;

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested n_shares = 0"
        )?;

        let from_vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let to_vault_shares_before: u128 = to.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let from_depositor_shares_before = self.checked_vault_shares(vault)?;
        let to_depositor_shares_before = to.checked_vault_shares(vault)?;

        self.decrease_vault_shares(n_shares, vault)?;
        to.increase_vault_shares(n_shares, vault)?;

        self.set_net_deposits(self.get_net_deposits().safe_sub(withdraw_value.cast()?)?);
        to.set_net_deposits(to.get_net_deposits().safe_add(withdraw_value.cast()?)?);

        let from_depositor_shares_after = self.checked_vault_shares(vault)?;
        let to_depositor_shares_after = to.checked_vault_shares(vault)?;

        validate!(
            from_depositor_shares_before.safe_add(to_depositor_shares_before)
                == from_depositor_shares_after.safe_add(to_depositor_shares_after),
            ErrorCode::InvalidVaultSharesDetected,
            "VaultDepositor: total shares mismatch"
        )?;

        emit!(ShareTransferRecord {
            ts: now,
            vault: vault.pubkey,
            from_vault_depositor: self.get_pubkey(),
            to_vault_depositor: to.get_pubkey(),

            shares: n_shares,
            value: withdraw_value,
            from_depositor_shares_before,
            from_depositor_shares_after,
            to_depositor_shares_before,
            to_depositor_shares_after,
        });

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.get_authority(),
            action: VaultDepositorAction::Withdraw,
            amount: withdraw_amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before: from_vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after: self.checked_vault_shares(vault)?,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share: from_profit_share,
            management_fee: management_fee_payment,
            management_fee_shares,
        });

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: to.get_authority(),
            action: VaultDepositorAction::Deposit,
            amount: withdraw_amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before: to_vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after: to.checked_vault_shares(vault)?,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share: to_profit_share,
            management_fee: management_fee_payment,
            management_fee_shares,
        });

        Ok((n_shares, vault_protocol.take()))
    }
}
