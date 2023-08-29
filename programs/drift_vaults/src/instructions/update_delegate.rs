use crate::constraints::{is_manager_for_vault, is_user_for_vault};
use crate::cpi::UpdateUserDelegateCPI;
use crate::Vault;
use crate::{declare_vault_seeds, implement_update_user_delegate_cpi};
use anchor_lang::prelude::*;
use drift::cpi::accounts::UpdateUser;
use drift::program::Drift;
use drift::state::user::User;

pub fn update_delegate<'info>(
    ctx: Context<'_, '_, '_, 'info, UpdateDelegate<'info>>,
    delegate: Pubkey,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    if vault.in_liquidation() {
        let now = Clock::get()?.unix_timestamp;
        vault.check_can_exit_liquidation(now)?;
        vault.reset_liquidation_delegate();
    }

    vault.delegate = delegate;

    drop(vault);

    ctx.drift_update_user_delegate(delegate)?;

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateDelegate<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    pub drift_program: Program<'info, Drift>,
}

impl<'info> UpdateUserDelegateCPI for Context<'_, '_, '_, 'info, UpdateDelegate<'info>> {
    fn drift_update_user_delegate(&self, delegate: Pubkey) -> Result<()> {
        implement_update_user_delegate_cpi!(self, delegate);
        Ok(())
    }
}
