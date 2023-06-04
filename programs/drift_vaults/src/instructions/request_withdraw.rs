use crate::constraints::{
    is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::error::ErrorCode;
use crate::validate;
use crate::{Vault, VaultDepositor};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use drift::instructions::optional_accounts::{load_maps, AccountMaps};
use drift::math::insurance::vault_amount_to_if_shares;
use drift::math::margin::{
    calculate_margin_requirement_and_total_collateral, MarginRequirementType,
};
use drift::state::perp_market_map::{get_writable_perp_market_set, MarketSet};
use drift::state::user::User;

pub fn request_withdraw<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>,
    amount: u64,
) -> Result<()> {
    let clock = &Clock::get()?;
    let vault = &mut ctx.accounts.vault.load_mut()?;
    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

    // todo, use calculate_net_usd_value in margin.rs
    let (net_usd_value, all_oracles_valid) = (100_u64, true);
    validate!(all_oracles_valid, ErrorCode::Default)?;

    let n_shares: u128 = vault_amount_to_if_shares(amount, vault.total_shares, net_usd_value)?;

    vault_depositor.request_withdraw(n_shares, net_usd_value, vault, clock.unix_timestamp)?;

    let spot_market_index = vault.spot_market_index;
    let remaining_accounts_iter = &mut ctx.remaining_accounts.iter().peekable();

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = load_maps(
        remaining_accounts_iter,
        &MarketSet::new(),
        &get_writable_perp_market_set(spot_market_index),
        clock.slot,
        None,
    )?;

    let user = ctx.accounts.drift_user.load()?;

    let (margin_requirement, total_collateral, _, _) =
        calculate_margin_requirement_and_total_collateral(
            &user,
            &perp_market_map,
            MarginRequirementType::Initial,
            &spot_market_map,
            &mut oracle_map,
            None,
        )?;

    msg!("total collateral: {}", total_collateral);
    msg!("margin requirement: {}", margin_requirement);

    Ok(())
}

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
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
}
