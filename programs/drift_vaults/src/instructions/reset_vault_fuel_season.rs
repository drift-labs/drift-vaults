use crate::state::Vault;
use anchor_lang::prelude::*;
use drift::ids::admin_hot_wallet;
use drift::state::state::State;

pub fn reset_vault_fuel_season<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ResetVaultFuelSeason<'info>>,
) -> Result<()> {
    let clock = &Clock::get()?;

    let mut vault = ctx.accounts.vault.load_mut()?;
    vault.reset_cumulative_fuel_per_share(clock.unix_timestamp);

    Ok(())
}

#[derive(Accounts)]
pub struct ResetVaultFuelSeason<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        constraint = admin.key() == drift_state.admin || admin.key() == admin_hot_wallet::id()
    )]
    pub admin: Signer<'info>,
    pub drift_state: Box<Account<'info, State>>,
}
