use anchor_lang::prelude::*;
use drift::state::state::State;
use drift::program::Drift;
use drift::cpi::accounts::{InitializeUserStats, InitializeUser};
use crate::{Vault, Size};

pub fn initialize(ctx: Context<Initialize>, name: [u8; 32]) -> Result<()> {
    let bump = ctx.bumps.get("vault").unwrap();

    let signature_seeds = [
        b"vault",
        name.as_ref(),
        bytemuck::bytes_of(bump),
    ];
    let signers = &[&signature_seeds[..]];
    let cpi_program = ctx.accounts.drift_program.to_account_info().clone();
    let cpi_accounts = InitializeUserStats {
        user_stats: ctx.accounts.drift_user_stats.clone().into(),
        state: ctx.accounts.drift_state.clone(),
        authority: ctx.accounts.vault.to_account_info().clone().into(),
        payer: ctx.accounts.payer.to_account_info().clone(),
        rent: ctx.accounts.rent.to_account_info().clone(),
        system_program: ctx.accounts.system_program.to_account_info().clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
    drift::cpi::initialize_user_stats(
        cpi_ctx
    )?;

    let cpi_program = ctx.accounts.drift_program.to_account_info().clone();
    let cpi_accounts = InitializeUser {
        user_stats: ctx.accounts.drift_user_stats.clone().into(),
        user: ctx.accounts.drift_user.clone().into(),
        state: ctx.accounts.drift_state.clone(),
        authority: ctx.accounts.vault.to_account_info().clone().into(),
        payer: ctx.accounts.payer.to_account_info().clone(),
        rent: ctx.accounts.rent.to_account_info().clone(),
        system_program: ctx.accounts.system_program.to_account_info().clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
    let sub_account_id = 0_u16;
    drift::cpi::initialize_user(
        cpi_ctx,
        sub_account_id,
        name,
    )?;

    let mut vault = ctx.accounts.vault.load_init()?;
    vault.name = name;
    vault.pubkey = *ctx.accounts.vault.to_account_info().key;
    vault.authority = *ctx.accounts.authority.key;
    vault.user_stats = *ctx.accounts.drift_user_stats.key;
    vault.user = *ctx.accounts.drift_user.key;
    vault.bump = *bump;

    Ok(())
}

#[derive(Accounts)]
#[instruction(
    name: [u8; 32],
)]
pub struct Initialize<'info> {
    #[account(
        init,
        seeds = [b"vault", name.as_ref()],
        space = Vault::SIZE,
        bump,
        payer = payer
    )]
    pub vault: AccountLoader<'info, Vault>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_user_stats: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_user: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_state: AccountInfo<'info>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub drift_program: Program<'info, Drift>,
}
