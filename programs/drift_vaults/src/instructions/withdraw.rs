use crate::constraints::{
    is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::cpi::{TokenTransferCPI, UpdateUserDelegateCPI, UpdateUserReduceOnlyCPI, WithdrawCPI};
use crate::{
    declare_vault_seeds, implement_update_user_delegate_cpi, implement_update_user_reduce_only_cpi,
    implement_withdraw, AccountMapProvider,
};
use crate::{Vault, VaultDepositor};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token::{Token, TokenAccount};
use drift::cpi::accounts::{UpdateUser, Withdraw as DriftWithdraw};
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::user::User;

pub fn withdraw<'c: 'info, 'info>(ctx: Context<'_, '_, 'c, 'info, Withdraw<'info>>) -> Result<()> {
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

    let (user_withdraw_amount, finishing_liquidation) =
        vault_depositor.withdraw(vault_equity, &mut vault, clock.unix_timestamp)?;

    msg!("user_withdraw_amount: {}", user_withdraw_amount);

    drop(vault);
    drop(user);

    ctx.drift_withdraw(user_withdraw_amount)?;

    ctx.token_transfer(user_withdraw_amount)?;

    if finishing_liquidation {
        let mut vault = ctx.accounts.vault.load_mut()?;
        let vault_delegate = vault.delegate;
        vault.reset_liquidation_delegate();
        drop(vault);

        ctx.drift_update_user_delegate(vault_delegate)?;
        ctx.drift_update_user_reduce_only(false)?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        seeds = [b"vault_depositor", vault.key().as_ref(), authority.key().as_ref()],
        bump,
        constraint = is_authority_for_vault_depositor(&vault_depositor, &authority)?,
    )]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault_token_account".as_ref(), vault.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,
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
    #[account(
        mut,
        token::mint = vault_token_account.mint
    )]
    pub drift_spot_market_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: checked in drift cpi
    pub drift_signer: AccountInfo<'info>,
    #[account(
        mut,
        token::authority = authority,
        token::mint = vault_token_account.mint
    )]
    pub user_token_account: Box<Account<'info, TokenAccount>>,
    pub drift_program: Program<'info, Drift>,
    pub token_program: Program<'info, Token>,
}

impl<'info> WithdrawCPI for Context<'_, '_, '_, 'info, Withdraw<'info>> {
    fn drift_withdraw(&self, amount: u64) -> Result<()> {
        implement_withdraw!(self, amount);
        Ok(())
    }
}

impl<'info> TokenTransferCPI for Context<'_, '_, '_, 'info, Withdraw<'info>> {
    fn token_transfer(&self, amount: u64) -> Result<()> {
        declare_vault_seeds!(self.accounts.vault, seeds);

        let cpi_accounts = Transfer {
            from: self.accounts.vault_token_account.to_account_info().clone(),
            to: self.accounts.user_token_account.to_account_info().clone(),
            authority: self.accounts.vault.to_account_info().clone(),
        };
        let token_program = self.accounts.token_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(token_program, cpi_accounts, seeds);

        token::transfer(cpi_context, amount)?;

        Ok(())
    }
}

impl<'info> UpdateUserDelegateCPI for Context<'_, '_, '_, 'info, Withdraw<'info>> {
    fn drift_update_user_delegate(&self, delegate: Pubkey) -> Result<()> {
        implement_update_user_delegate_cpi!(self, delegate);
        Ok(())
    }
}

impl<'info> UpdateUserReduceOnlyCPI for Context<'_, '_, '_, 'info, Withdraw<'info>> {
    fn drift_update_user_reduce_only(&self, reduce_only: bool) -> Result<()> {
        implement_update_user_reduce_only_cpi!(self, reduce_only);
        Ok(())
    }
}
