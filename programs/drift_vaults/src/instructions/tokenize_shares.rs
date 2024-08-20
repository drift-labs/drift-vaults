use crate::constraints::{
    is_authority_for_vault_depositor, is_mint_for_tokenized_depositor,
    is_tokenized_depositor_for_vault, is_user_for_vault,
};
use crate::drift_cpi::MintTokensCPI;
use crate::error::ErrorCode;
use crate::state::traits::VaultDepositorBase;
use crate::{validate, AccountMapProvider};
use crate::{TokenizedVaultDepositor, Vault, VaultDepositor, VaultProtocolProvider, WithdrawUnit};
use anchor_lang::prelude::*;
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};
use drift::instructions::optional_accounts::AccountMaps;
use drift::math::safe_math::SafeMath;
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

    // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
    let mut vp = ctx.vault_protocol();
    let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

    validate!(
        (vault.vault_protocol == Pubkey::default() && vp.is_none())
            || (vault.vault_protocol != Pubkey::default() && vp.is_some()),
        ErrorCode::VaultProtocolMissing,
        "vault protocol missing in remaining accounts"
    )?;

    validate!(
        vault.shares_base == tokenized_vault_depositor.vault_shares_base,
        ErrorCode::InvalidVaultRebase,
        "Cannot tokenize shares after a rebase, must manually trigger TokenizedVaultDepositor::rebase() ({:?} vs. {:?})",
        vault.shares_base,
        tokenized_vault_depositor.vault_shares_base
    )?;

    let total_shares_before = vault_depositor
        .get_vault_shares()
        .safe_add(tokenized_vault_depositor.get_vault_shares())?;

    let user = ctx.accounts.drift_user.load()?;
    let spot_market_index = vault.spot_market_index;
    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(spot_market_index), vp.is_some())?;

    let vault_equity =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    validate!(
        !vault_depositor.last_withdraw_request.pending(),
        ErrorCode::InvalidVaultDeposit,
        "Cannot tokenize shares with a pending withdraw request"
    )?;

    let total_supply_before = ctx.accounts.mint.supply;

    let tokens_to_mint = match vp {
        None => {
            let (shares_transferred, _) = vault_depositor.transfer_shares(
                &mut *tokenized_vault_depositor,
                &mut vault,
                &mut None,
                amount,
                unit,
                vault_equity,
                clock.unix_timestamp,
            )?;
            tokenized_vault_depositor.tokenize_shares(
                &mut vault,
                &mut None,
                total_supply_before,
                vault_equity,
                shares_transferred,
                clock.unix_timestamp,
            )?
        }
        Some(vp) => {
            let (shares_transferred, mut vp) = vault_depositor.transfer_shares(
                &mut *tokenized_vault_depositor,
                &mut vault,
                &mut Some(vp),
                amount,
                unit,
                vault_equity,
                clock.unix_timestamp,
            )?;
            tokenized_vault_depositor.tokenize_shares(
                &mut vault,
                &mut vp,
                total_supply_before,
                vault_equity,
                shares_transferred,
                clock.unix_timestamp,
            )?
        }
    };

    let total_shares_after = vault_depositor
        .get_vault_shares()
        .safe_add(tokenized_vault_depositor.get_vault_shares())?;

    validate!(
        total_shares_after.eq(&total_shares_before),
        ErrorCode::InvalidVaultSharesDetected,
        "Total vault depositor shares before != after"
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

    ctx.accounts.mint.reload()?;
    let total_supply_after = ctx.accounts.mint.supply;

    validate!(
        total_supply_after > total_supply_before,
        ErrorCode::InvalidTokenization,
        "Total supply after < total supply before"
    )?;

    let supply_delta = total_supply_after.safe_sub(total_supply_before)?;
    validate!(
        supply_delta.eq(&tokens_to_mint),
        ErrorCode::InvalidTokenization,
        "Tokens minted ({}) != supply delta ({})",
        tokens_to_mint,
        supply_delta
    )?;

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
