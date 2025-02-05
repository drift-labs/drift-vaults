use anchor_lang::prelude::*;
use drift::state::user::{FuelOverflowStatus, UserStats};

use crate::constraints::{
    is_delegate_for_vault, is_manager_for_vault, is_user_stats_for_vault,
    is_vault_for_vault_depositor,
};
use crate::state::{FuelOverflowProvider, Vault, VaultProtocolProvider};
use crate::VaultDepositor;

pub fn update_cumulative_fuel_amount<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, UpdateCumulativeFuelAmount<'info>>,
) -> Result<()> {
    let clock = &Clock::get()?;

    let vault = ctx.accounts.vault.load()?;
    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

    // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
    let mut vp = ctx.vault_protocol();
    vault.validate_vault_protocol(&vp)?;
    let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

    let user_stats = ctx.accounts.drift_user_stats.load()?;
    let has_fuel_overflow = FuelOverflowStatus::exists(user_stats.fuel_overflow_status);
    let fuel_overflow = ctx.fuel_overflow(vp.is_some(), has_fuel_overflow);
    user_stats.validate_fuel_overflow(&fuel_overflow)?;

    let fuel_amount = vault_depositor.update_cumulative_fuel_amount(
        clock.unix_timestamp,
        &vault,
        &user_stats,
        &fuel_overflow,
    )?;
    msg!("new fuel_amount: {}", fuel_amount);

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateCumulativeFuelAmount<'info> {
    #[account(
        constraint = is_manager_for_vault(&vault, &manager)? || is_delegate_for_vault(&vault, &manager)?
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        constraint = is_vault_for_vault_depositor(&vault_depositor, &vault)?
    )]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountLoader<'info, UserStats>,
}
