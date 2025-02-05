use anchor_lang::prelude::*;

use crate::constraints::is_manager_for_vault;
use crate::Vault;

pub fn manager_update_fuel_distribution_mode<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ManagerUpdateFuelDistributionMode<'info>>,
    fuel_distribution_mode: u8,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    vault.update_fuel_distribution_mode(fuel_distribution_mode);

    Ok(())
}

#[derive(Accounts)]
pub struct ManagerUpdateFuelDistributionMode<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
}
