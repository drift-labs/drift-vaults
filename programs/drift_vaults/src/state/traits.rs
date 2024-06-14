use crate::error::ErrorCode;
use crate::state::vault::Vault;
use crate::validate;
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

    fn on_shares_change(&mut self, is_increase: bool, delta: u128, vault: &Vault) -> Result<()> {
        // Default implementation: no-op
        Ok(())
    }

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
        self.on_shares_change(true, delta, vault)?;
        Ok(())
    }

    fn decrease_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.set_vault_shares(self.get_vault_shares().safe_sub(delta)?);
        self.on_shares_change(false, delta, vault)?;
        Ok(())
    }

    fn update_vault_shares(&mut self, new_shares: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        let old_shares = self.get_vault_shares();
        self.set_vault_shares(new_shares);

        let is_increase = new_shares > old_shares;
        let delta = if is_increase {
            new_shares - old_shares
        } else {
            old_shares - new_shares
        };
        self.on_shares_change(is_increase, delta, vault)?;

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

    fn apply_rebase(&mut self, vault: &mut Vault, vault_equity: u64) -> Result<Option<u128>> {
        vault.apply_rebase(vault_equity)?;

        let mut rebase_divisor: Option<u128> = None;

        if vault.shares_base != self.get_vault_shares_base() {
            validate!(
                vault.shares_base > self.get_vault_shares_base(),
                ErrorCode::InvalidVaultRebase,
                "Rebase expo out of bounds"
            )?;

            let expo_diff = (vault.shares_base - self.get_vault_shares_base()).cast::<u32>()?;

            rebase_divisor = Some(10_u128.pow(expo_diff));

            msg!(
                "rebasing vault depositor: base: {} -> {} ",
                self.get_vault_shares_base(),
                vault.shares_base,
            );

            self.set_vault_shares_base(vault.shares_base);

            let old_vault_shares = self.unchecked_vault_shares();
            let new_vault_shares = old_vault_shares.safe_div(rebase_divisor.unwrap())?;

            msg!("rebasing vault depositor: shares -> {} ", new_vault_shares);

            self.update_vault_shares(new_vault_shares, vault)?;
        }

        validate!(
            self.get_vault_shares_base() == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor shares_base != vault shares_base"
        )?;

        Ok(rebase_divisor)
    }
}
