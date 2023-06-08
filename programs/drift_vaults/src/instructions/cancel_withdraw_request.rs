use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::math::casting::Cast;
use drift::math::margin::calculate_user_equity;
use drift::state::user::User;

use crate::constraints::{
    is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::validation::validate_equity;
use crate::AccountMapProvider;
use crate::{Vault, VaultDepositor};

pub fn cancel_withdraw_request<'info>(
    ctx: Context<'_, '_, '_, 'info, CancelWithdrawRequest<'info>>,
) -> Result<()> {
    let clock = &Clock::get()?;
    let vault = &mut ctx.accounts.vault.load_mut()?;
    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

    let user = ctx.accounts.drift_user.load()?;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, None)?;

    let vault_equity =
        calculate_user_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)
            .and_then(validate_equity)?;

    vault_depositor.cancel_withdraw_request(vault_equity.cast()?, vault, clock.unix_timestamp)?;

    Ok(())
}

#[derive(Accounts)]
pub struct CancelWithdrawRequest<'info> {
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
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    #[account(
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    pub drift_state: AccountInfo<'info>,
}
