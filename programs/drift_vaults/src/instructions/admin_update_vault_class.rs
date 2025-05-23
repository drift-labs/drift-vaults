use anchor_lang::prelude::*;

use crate::constraints::is_admin;
use crate::state::{Vault, VaultClass};
use crate::{error::ErrorCode, validate};

pub fn admin_update_vault_class<'info>(
    ctx: Context<'_, '_, '_, 'info, AdminUpdateVaultClass<'info>>,
    new_vault_class: VaultClass,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    validate!(
        vault.vault_class != new_vault_class,
        ErrorCode::InvalidVaultUpdate
    )?;

    msg!(
        "Updating vault class from {:?} to {:?}",
        vault.vault_class,
        new_vault_class
    );
    vault.vault_class = new_vault_class;

    Ok(())
}

#[derive(Accounts)]
pub struct AdminUpdateVaultClass<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        constraint = is_admin(&admin)?,
    )]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}
