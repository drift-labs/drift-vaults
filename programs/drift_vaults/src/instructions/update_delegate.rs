use crate::constraints::{is_authority_for_vault, is_user_for_vault};
use crate::cpi;
use crate::Vault;
use anchor_lang::prelude::*;
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

    let name = vault.name;
    let bump = vault.bump;

    vault.delegate = delegate;

    drop(vault);

    cpi::drift::update_user_delegate(
        delegate,
        name,
        bump,
        ctx.accounts.drift_program.to_account_info().clone(),
        ctx.accounts.drift_user.to_account_info().clone(),
        ctx.accounts.vault.to_account_info().clone(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateDelegate<'info> {
    #[account(
        mut,
        constraint = is_authority_for_vault(&vault, &authority)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    pub drift_program: Program<'info, Drift>,
}
