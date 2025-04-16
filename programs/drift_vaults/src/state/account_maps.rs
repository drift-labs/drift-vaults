use anchor_lang::prelude::Context;
use drift::error::DriftResult;
use drift::instructions::optional_accounts::{load_maps, AccountMaps};
use drift::state::spot_market_map::get_writable_spot_market_set;
use drift::state::user::FuelOverflow;
use std::collections::BTreeSet;

use crate::state::FeeUpdate;
use crate::state::VaultProtocol;
use anchor_lang::prelude::*;

pub trait AccountMapProvider<'a> {
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market: Option<u16>,
        has_vault_protocol: bool,
        has_fuel_overflow: bool,
        has_fee_update: bool,
    ) -> DriftResult<AccountMaps<'a>>;
}

impl<'a: 'info, 'info, T: anchor_lang::Bumps> AccountMapProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market_index: Option<u16>,
        has_vault_protocol: bool,
        has_fuel_overflow: bool,
        has_fee_update: bool,
    ) -> DriftResult<AccountMaps<'a>> {
        // if [`VaultProtocol`] exists it will be the last index in the remaining_accounts, so we need to skip it.
        let mut end_index = self.remaining_accounts.len() - (has_vault_protocol as usize);
        // if there is a [`FuelOverflow`], we need to skip one more account
        end_index -= has_fuel_overflow as usize;
        // if there is a [`FeeUpdate`], we need to skip one more account
        end_index -= has_fee_update as usize;

        let remaining_accounts_iter = &mut self.remaining_accounts[..end_index].iter().peekable();
        load_maps(
            remaining_accounts_iter,
            &BTreeSet::new(),
            &writable_spot_market_index
                .map(get_writable_spot_market_set)
                .unwrap_or_default(),
            slot,
            None,
        )
    }
}

pub trait VaultProtocolProvider<'a> {
    fn vault_protocol(&self) -> Option<AccountLoader<'a, VaultProtocol>>;
}

/// Provides the last remaining account as a [`VaultProtocol`].
impl<'a: 'info, 'info, T: anchor_lang::Bumps> VaultProtocolProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn vault_protocol(&self) -> Option<AccountLoader<'a, VaultProtocol>> {
        let acct = match self.remaining_accounts.last() {
            Some(acct) => acct,
            None => return None,
        };
        AccountLoader::<'a, VaultProtocol>::try_from(acct).ok()
    }
}

pub trait FuelOverflowProvider<'a> {
    fn fuel_overflow(
        &self,
        has_vp: bool,
        has_fuel_overflow: bool,
    ) -> Option<AccountLoader<'a, FuelOverflow>>;
}

/// Provides [`FuelOverflow`] from remaining_accounts, respects whether the vault has a VaultProtocol.
impl<'a: 'info, 'info, T: anchor_lang::Bumps> FuelOverflowProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn fuel_overflow(
        &self,
        has_vp: bool,
        has_fuel_overflow: bool,
    ) -> Option<AccountLoader<'a, FuelOverflow>> {
        if !has_fuel_overflow {
            None
        } else {
            let acct_idx = if has_vp {
                // if there is a [`VaultProtocol`], the [`FuelOverflow`] is the second to last account
                self.remaining_accounts.len() - 2
            } else {
                // otherwise [`FuelOverflow`] is the last account
                self.remaining_accounts.len() - 1
            };
            let acct = self.remaining_accounts.get(acct_idx)?;

            AccountLoader::<'a, FuelOverflow>::try_from(acct).ok()
        }
    }
}

pub trait FeeUpdateProvider<'a> {
    fn fee_update(
        &self,
        has_vp: bool,
        has_fuel_overflow: bool,
        has_fee_update: bool,
    ) -> Option<AccountLoader<'a, FeeUpdate>>;
}

/// Provides [`FeeUpdate`] from remaining_accounts, respects whether the vault has a VaultProtocol and FuelOverflow.
impl<'a: 'info, 'info, T: anchor_lang::Bumps> FeeUpdateProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn fee_update(
        &self,
        has_vp: bool,
        has_fuel_overflow: bool,
        has_fee_update: bool,
    ) -> Option<AccountLoader<'a, FeeUpdate>> {
        if !has_fee_update {
            None
        } else {
            let acct_idx = if has_vp {
                if has_fuel_overflow {
                    // if there is a [`VaultProtocol`] and [`FuelOverflow`], the [`FeeUpdate`] is the third to last account
                    self.remaining_accounts.len() - 3
                } else {
                    // if there is only a [`VaultProtocol`], the [`FeeUpdate`] is the second to last account
                    self.remaining_accounts.len() - 2
                }
            } else if has_fuel_overflow {
                // if there is only a [`FuelOverflow`], the [`FeeUpdate`] is the second to last account
                self.remaining_accounts.len() - 2
            } else {
                // otherwise [`FeeUpdate`] is the last account
                self.remaining_accounts.len() - 1
            };
            let acct = self.remaining_accounts.get(acct_idx)?;

            AccountLoader::<'a, FeeUpdate>::try_from(acct).ok()
        }
    }
}
