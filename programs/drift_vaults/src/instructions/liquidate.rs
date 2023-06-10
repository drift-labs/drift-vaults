use crate::constraints::{
    is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::cpi;
use crate::AccountMapProvider;
use crate::{Vault, VaultDepositor};
use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::user::User;

pub fn liquidate<'info>(ctx: Context<'_, '_, '_, 'info, Liquidate<'info>>) -> Result<()> {
    let clock = &Clock::get()?;
    let now = Clock::get()?.unix_timestamp;

    let mut user = ctx.accounts.drift_user.load_mut()?;
    let mut vault = ctx.accounts.vault.load_mut()?;
    let vault_depositor = ctx.accounts.vault_depositor.load()?;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(vault.spot_market_index))?;

    // 1. Check the vault depositor has waited the redeem period
    vault_depositor.check_redeem_period_finished(&vault, now)?;
    // 2. Check that the depositor is unable to withdraw
    vault_depositor.check_cant_withdraw(
        &vault,
        &mut user,
        &perp_market_map,
        &spot_market_map,
        &mut oracle_map,
    )?;
    // 3. Check that the vault is not already in liquidation for another depositor
    vault.check_delegate_available_for_liquidation(&vault_depositor, now)?;

    vault.liquidation_start_ts = now;
    vault.liquidation_delegate = vault_depositor.authority;

    let name = vault.name;
    let bump = vault.bump;
    drop(vault);

    cpi::drift::update_user_delegate(
        vault_depositor.authority,
        name,
        bump,
        ctx.accounts.drift_program.to_account_info().clone(),
        ctx.accounts.drift_user.to_account_info().clone(),
        ctx.accounts.vault.to_account_info().clone(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        seeds = [b"vault_depositor", vault.key().as_ref()],
        bump,
        constraint = is_authority_for_vault_depositor(&vault_depositor, &authority)?,
    )]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    pub drift_state: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
}
