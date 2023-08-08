use crate::constraints::{is_manager_for_vault, is_user_for_vault, is_user_stats_for_vault};
use crate::{Vault, VaultDepositor};

use crate::AccountMapProvider;
use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::user::User;

pub fn manager_crank_profit_share(ctx: Context<ManagerCrankProfitShare>) -> Result<()> {
    let clock = &Clock::get()?;

    let mut vault = ctx.accounts.vault.load_mut()?;
    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

    let user = ctx.accounts.drift_user.load()?;
    let spot_market_index = vault.spot_market_index;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(spot_market_index))?;

    let vault_equity =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    vault_depositor.apply_profit_share(vault_equity, &mut vault)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ManagerCrankProfitShare<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(mut)]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    pub manager: Signer<'info>,
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
    /// CHECK: checked in drift cpi
    pub drift_signer: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
}
