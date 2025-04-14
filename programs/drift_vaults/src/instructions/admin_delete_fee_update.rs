use anchor_lang::prelude::*;

use crate::constraints::is_admin;
use crate::state::{FeeUpdate, FeeUpdateStatus, Vault};
use crate::{error::ErrorCode, validate};

pub fn admin_delete_fee_update<'info>(
    ctx: Context<'_, '_, '_, 'info, AdminDeleteFeeUpdate<'info>>,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;
    validate!(
        vault.fee_update_status == FeeUpdateStatus::HasFeeUpdate as u8,
        ErrorCode::InvalidVaultUpdate,
        "vault does not have a FeeUpdate account"
    )?;

    vault.fee_update_status = FeeUpdateStatus::None as u8;

    Ok(())
}

#[derive(Accounts)]
pub struct AdminDeleteFeeUpdate<'info> {
    #[account(mut)]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        constraint = is_admin(&admin)?,
    )]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fee_update".as_ref(), vault.key().as_ref()],
        bump,
        close = admin,
    )]
    pub fee_update: AccountLoader<'info, FeeUpdate>,
}
