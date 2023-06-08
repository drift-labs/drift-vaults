use crate::constraints::{is_authority_for_vault, is_user_for_vault};
use crate::Vault;
use anchor_lang::prelude::*;
use drift::cpi::accounts::UpdateUser;
use drift::program::Drift;
use drift::state::user::User;

pub fn update_delegate<'info>(
    ctx: Context<'_, '_, '_, 'info, UpdateDelegate<'info>>,
    delegate: Pubkey,
) -> Result<()> {
    let vault = ctx.accounts.vault.load()?;
    let name = vault.name;
    let bump = vault.bump;
    drop(vault);

    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    let signers = &[&signature_seeds[..]];

    let cpi_program = ctx.accounts.drift_program.to_account_info().clone();
    let cpi_accounts = UpdateUser {
        user: ctx.accounts.drift_user.to_account_info().clone(),
        authority: ctx.accounts.vault.to_account_info().clone(),
    };
    let cpi_context = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
    drift::cpi::update_user_delegate(cpi_context, 0, delegate)?;

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
