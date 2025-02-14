use anchor_lang::prelude::*;
use drift::ids::admin_hot_wallet;
use drift::state::state::State;
use drift::state::user::{FuelOverflowStatus, UserStats};

use crate::constraints::{is_user_stats_for_vault, is_vault_for_vault_depositor};
use crate::state::events::FuelSeasonRecord;
use crate::state::{FuelOverflowProvider, Vault, VaultProtocolProvider};
use crate::VaultDepositor;

pub fn reset_fuel_season<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ResetFuelSeason<'info>>,
) -> Result<()> {
    let clock = &Clock::get()?;

    let mut vault = ctx.accounts.vault.load_mut()?;
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
        &mut vault,
        &user_stats,
        &fuel_overflow,
    )?;
    msg!("new fuel_amount: {}", fuel_amount);

    emit!(FuelSeasonRecord {
        ts: clock.unix_timestamp,
        authority: vault_depositor.authority,
        fuel_insurance: 0,
        fuel_deposits: 0,
        fuel_borrows: 0,
        fuel_positions: 0,
        fuel_taker: 0,
        fuel_maker: 0,
        fuel_total: fuel_amount,
    });

    vault_depositor.reset_fuel_amount(clock.unix_timestamp);

    Ok(())
}

#[derive(Accounts)]
pub struct ResetFuelSeason<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        constraint = is_vault_for_vault_depositor(&vault_depositor, &vault)?
    )]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    #[account(
        constraint = admin.key() == drift_state.admin || admin.key() == admin_hot_wallet::id()
    )]
    pub admin: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountLoader<'info, UserStats>,
    pub drift_state: Box<Account<'info, State>>,
}
