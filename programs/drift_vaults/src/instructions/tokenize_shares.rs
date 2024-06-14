use crate::constraints::{
    is_authority_for_vault_depositor, is_mint_for_tokenized_depositor,
    is_tokenized_depositor_for_vault, is_user_for_vault,
};
use crate::cpi::MintTokensCPI;
use crate::error::ErrorCode;
use crate::state::traits::VaultDepositorBase;
use crate::{validate, AccountMapProvider};
use crate::{TokenizedVaultDepositor, Vault, VaultDepositor, WithdrawUnit};
use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};
use drift::instructions::optional_accounts::AccountMaps;
use drift::state::user::User;

pub fn tokenize_shares<'info>(
    ctx: Context<'_, '_, 'info, 'info, TokenizeShares<'info>>,
    amount: u64,
    unit: WithdrawUnit,
) -> Result<()> {
    let clock = &Clock::get()?;

    let mut vault = ctx.accounts.vault.load_mut()?;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;

    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;
    let mut tokenized_vault_depositor = ctx.accounts.tokenized_vault_depositor.load_mut()?;

    let user = ctx.accounts.drift_user.load()?;
    let spot_market_index = vault.spot_market_index;
    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(spot_market_index))?;

    let vault_equity =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    validate!(
        !vault_depositor.last_withdraw_request.pending(),
        ErrorCode::InvalidVaultDeposit,
        "Cannot tokenize shares with a pending withdraw request"
    )?;

    let shares_transferred = vault_depositor.transfer_shares(
        &mut *tokenized_vault_depositor,
        &mut vault,
        amount,
        unit,
        vault_equity,
        clock.unix_timestamp,
    )?;

    let tokens_to_mint = tokenized_vault_depositor.tokenize_shares(
        &mut vault,
        ctx.accounts.mint.supply,
        vault_equity,
        shares_transferred,
        clock.unix_timestamp,
    )?;

    let vault_name = vault.name;
    let vault_bump = vault.bump;

    drop(vault);
    drop(vault_depositor);
    drop(tokenized_vault_depositor);

    ctx.mint(vault_name, vault_bump, tokens_to_mint)?;

    msg!(
        "Minted {} tokens to {}",
        tokens_to_mint,
        ctx.accounts.user_token_account.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct TokenizeShares<'info> {
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
		constraint = is_tokenized_depositor_for_vault(&tokenized_vault_depositor, &vault)?,
	)]
    pub tokenized_vault_depositor: AccountLoader<'info, TokenizedVaultDepositor>,
    #[account(
        mut,
        seeds = [b"mint", vault.key().as_ref()],
        bump,
        mint::authority = vault.key(),
		constraint = is_mint_for_tokenized_depositor(&mint.key(), &tokenized_vault_depositor)?,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        token::authority = authority,
        token::mint = tokenized_vault_depositor.load()?.mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    pub token_program: Program<'info, Token>,
}

impl<'info> MintTokensCPI for Context<'_, '_, '_, 'info, TokenizeShares<'info>> {
    fn mint(&self, vault_name: [u8; 32], vault_bump: u8, amount: u64) -> Result<()> {
        let signature_seeds = Vault::get_vault_signer_seeds(&vault_name, &vault_bump);
        let signers = &[&signature_seeds[..]];

        let cpi_accounts = MintTo {
            mint: self.accounts.mint.to_account_info(),
            to: self.accounts.user_token_account.to_account_info(),
            authority: self.accounts.vault.to_account_info(),
        };

        let cpi_context = CpiContext::new_with_signer(
            self.accounts.token_program.to_account_info(),
            cpi_accounts,
            signers,
        );

        mint_to(cpi_context, amount)?;

        Ok(())
    }
}
