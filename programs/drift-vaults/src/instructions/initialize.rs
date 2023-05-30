use anchor_lang::prelude::*;
use drift::state::state::State;
use drift::program::Drift;
use drift::cpi::accounts::InitializeUserStats;

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let (authority, authority_nonce) = Pubkey::find_program_address(
        &[],
        ctx.program_id,
    );

    if authority != *ctx.accounts.authority.to_account_info().key {
        panic!();
    }

    let signature_seeds = [
        bytemuck::bytes_of(&authority_nonce),
    ];
    let signers = &[&signature_seeds[..]];
    let cpi_program = ctx.accounts.drift_program.to_account_info();
    let cpi_accounts = InitializeUserStats {
        user_stats: ctx.accounts.drift_user_stats.clone().into(),
        state: ctx.accounts.drift_state.clone(),
        authority: ctx.accounts.authority.clone().into(),
        payer: ctx.accounts.payer.to_account_info().clone(),
        rent: ctx.accounts.rent.to_account_info().clone(),
        system_program: ctx.accounts.system_program.to_account_info().clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
    drift::cpi::initialize_user_stats(
        cpi_ctx
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_user_stats: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_state: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub drift_program: Program<'info, Drift>,
}
