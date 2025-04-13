use anchor_lang::prelude::*;

use crate::constraints::is_manager_for_vault;
use crate::state::traits::Size;
use crate::state::{FeeUpdate, FeeUpdateStatus, Vault};
use crate::{error::ErrorCode, validate};

pub fn manager_init_fee_update<'info>(
    ctx: Context<'_, '_, '_, 'info, ManagerInitFeeUpdate<'info>>,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;
    let mut fee_update = ctx.accounts.fee_update.load_init()?;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;
    validate!(
        vault.fee_update_status == FeeUpdateStatus::None as u8,
        ErrorCode::InvalidVaultUpdate,
        "vault already has a FeeUpdate account"
    )?;

    fee_update.reset();

    vault.fee_update_status = FeeUpdateStatus::HasFeeUpdate as u8;

    Ok(())
}

#[derive(Accounts)]
pub struct ManagerInitFeeUpdate<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(mut)]
    pub manager: Signer<'info>,
    #[account(
        init,
        seeds = [b"fee_update".as_ref(), vault.key().as_ref()],
        bump,
        payer = manager,
        space = FeeUpdate::SIZE,
    )]
    pub fee_update: AccountLoader<'info, FeeUpdate>,
    pub system_program: Program<'info, System>,
}
