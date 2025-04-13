use crate::constraints::is_manager_for_vault;
use crate::state::events::{FeeUpdateAction, FeeUpdateRecord};
use crate::state::FeeUpdate;
use crate::{error::ErrorCode, validate, Vault};
use anchor_lang::prelude::*;
use drift::math::safe_math::SafeMath;

pub fn manager_update_fees<'info>(
    ctx: Context<'_, '_, '_, 'info, ManagerUpdateFees<'info>>,
    params: ManagerUpdateFeesParams,
) -> Result<()> {
    let vault = ctx.accounts.vault.load_mut()?;
    let mut fee_update = ctx.accounts.fee_update.load_mut()?;

    let now = Clock::get()?.unix_timestamp;

    validate!(
        params.timelock_duration > 0,
        ErrorCode::InvalidVaultUpdate,
        "Timelock duration must be greater than 0"
    )?;

    let timelock_end_ts = now.safe_add(params.timelock_duration)?;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;

    let min_fee_queue_period = vault.redeem_period.max(86_400);
    validate!(
        params.timelock_duration >= min_fee_queue_period,
        ErrorCode::InvalidVaultUpdate,
        "Fee updates must be queued for at least max(1 day, 1 redeem period)"
    )?;

    let old_management_fee = vault.management_fee;
    let old_profit_share = vault.profit_share;
    let old_hurdle_rate = vault.hurdle_rate;

    fee_update.incoming_management_fee = params.new_management_fee.unwrap_or(old_management_fee);
    fee_update.incoming_profit_share = params.new_profit_share.unwrap_or(old_profit_share);
    fee_update.incoming_hurdle_rate = params.new_hurdle_rate.unwrap_or(old_hurdle_rate);

    emit!(FeeUpdateRecord {
        ts: Clock::get()?.unix_timestamp,
        action: FeeUpdateAction::Pending,
        timelock_end_ts,
        vault: vault.pubkey,
        old_management_fee,
        old_profit_share,
        old_hurdle_rate,
        new_management_fee: fee_update.incoming_management_fee,
        new_profit_share: fee_update.incoming_profit_share,
        new_hurdle_rate: fee_update.incoming_hurdle_rate,
    });
    Ok(())
}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub struct ManagerUpdateFeesParams {
    pub timelock_duration: i64,
    pub new_management_fee: Option<i64>,
    pub new_profit_share: Option<u32>,
    pub new_hurdle_rate: Option<u32>,
}

#[derive(Accounts)]
pub struct ManagerUpdateFees<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fee_update".as_ref(), vault.key().as_ref()],
        bump,
    )]
    pub fee_update: AccountLoader<'info, FeeUpdate>,
}
