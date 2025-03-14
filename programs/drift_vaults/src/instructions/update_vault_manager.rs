use anchor_lang::prelude::*;

use super::UpdateVault;

pub fn update_vault_manager<'info>(
    ctx: Context<'_, '_, '_, 'info, UpdateVault<'info>>,
    manager: Pubkey,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    msg!("Updating vault manager {} -> {}", vault.manager, manager);
    vault.manager = manager;

    Ok(())
}
