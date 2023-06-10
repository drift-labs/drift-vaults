use crate::constraints::{
    is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::cpi;
use crate::AccountMapProvider;
use crate::{Vault, VaultDepositor};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::user::User;

pub fn withdraw<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
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

    let name = vault.name;
    let bump = vault.bump;
    let spot_market_index = vault.spot_market_index;
    drop(vault);
    drop(user);

    cpi::drift::withdraw(
        spot_market_index,
        user_withdraw_amount,
        name,
        bump,
        ctx.accounts.drift_program.to_account_info().clone(),
        ctx.accounts.drift_state.to_account_info().clone(),
        ctx.accounts.drift_user.to_account_info().clone(),
        ctx.accounts.drift_user_stats.to_account_info().clone(),
        ctx.accounts.vault.to_account_info().clone(),
        ctx.accounts
            .drift_spot_market_vault
            .to_account_info()
            .clone(),
        ctx.accounts.drift_signer.to_account_info().clone(),
        ctx.accounts.vault_token_account.to_account_info().clone(),
        ctx.accounts.token_program.to_account_info().clone(),
        ctx.remaining_accounts.into(),
    )?;

    cpi::token::transfer_with_signer_seeds(
        user_withdraw_amount,
        name,
        bump,
        ctx.accounts.vault_token_account.to_account_info().clone(),
        ctx.accounts.user_token_account.to_account_info().clone(),
        ctx.accounts.vault.to_account_info().clone(),
        ctx.accounts.token_program.to_account_info().clone(),
    )?;

    if finishing_liquidation {
        let mut vault = ctx.accounts.vault.load_mut()?;
        let vault_delegate = vault.delegate;
        vault.reset_liquidation_delegate();
        drop(vault);

        cpi::drift::update_user_delegate(
            vault_delegate,
            name,
            bump,
            ctx.accounts.drift_program.to_account_info().clone(),
            ctx.accounts.drift_user.to_account_info().clone(),
            ctx.accounts.vault.to_account_info().clone(),
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        seeds = [b"vault_depositor", vault.key().as_ref()],
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
