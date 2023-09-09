use crate::constraints::{
    is_manager_for_vault, is_spot_market_index, is_user_for_vault, is_user_stats_for_vault,
};

use crate::cpi::DeleteUserCPI;
use crate::declare_vault_seeds;
use crate::{error::ErrorCode, validate, Vault};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use drift::cpi::accounts::DeleteUser as DriftDeleteUser;
use drift::program::Drift;
use drift::state::spot_market::SpotMarket;
use drift::state::user::User;

pub fn delete_vault<'info>(ctx: Context<'_, '_, '_, 'info, DeleteVault<'info>>) -> Result<()> {
    let vault = ctx.accounts.vault.load()?;

    validate!(
        vault.total_shares == 0,
        ErrorCode::VaultCantBeDeleted,
        "cannot delete vault with outstanding shares"
    );

    ctx.delete_user(vault.name, vault.bump)?;

    Ok(())
}

#[derive(Accounts)]
pub struct DeleteVault<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
        close = payer,
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        close = payer,
    )]
    pub token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = is_spot_market_index(&vault, drift_spot_market.load()?.market_index)?,
    )]
    pub drift_spot_market: AccountLoader<'info, SpotMarket>,
    #[account(
        mut,
        constraint = drift_spot_market.load()?.mint.eq(&drift_spot_market_mint.key())
    )]
    pub drift_spot_market_mint: Box<Account<'info, Mint>>,
    /// CHECK: checked in drift cpi
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?,
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?,
        // close = manager
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_state: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
    #[account(mut)]
    pub manager: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> DeleteUserCPI for Context<'_, '_, '_, 'info, DeleteVault<'info>> {
    fn delete_user(&self, name: [u8; 32], bump: u8) -> Result<()> {
        let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
        let signers = &[&signature_seeds[..]];

        let cpi_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_accounts = DriftDeleteUser {
            state: self.accounts.drift_state.clone(),
            user: self.accounts.drift_user.to_account_info().clone(),
            user_stats: self.accounts.drift_user_stats.clone(),
            authority: self.accounts.vault.to_account_info().clone(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
        // .with_remaining_accounts(self.remaining_accounts.into());

        drift::cpi::delete_user(cpi_ctx)?;

        Ok(())
    }
}
