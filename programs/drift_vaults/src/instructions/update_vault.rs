use crate::constraints::is_manager_for_vault;
use crate::{error::ErrorCode, validate, Vault};
use anchor_lang::prelude::*;

pub fn update_vault<'info>(
    ctx: Context<'_, '_, '_, 'info, UpdateVault<'info>>,
    params: UpdateVaultParams,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;

    if let Some(redeem_period) = params.redeem_period {
        validate!(
            redeem_period < vault.redeem_period,
            ErrorCode::InvalidVaultUpdate,
            "new redeem period must be shorter than existing redeem period"
        )?;
        vault.redeem_period = redeem_period;
    }

    if let Some(max_tokens) = params.max_tokens {
        vault.max_tokens = max_tokens;
    }

    if let Some(min_deposit_amount) = params.min_deposit_amount {
        vault.min_deposit_amount = min_deposit_amount;
    }

    if let Some(management_fee) = params.management_fee {
        validate!(
            management_fee < vault.management_fee,
            ErrorCode::InvalidVaultUpdate,
            "new management fee must be less than existing management fee"
        )?;
        vault.management_fee = management_fee;
    }

    if let Some(profit_share) = params.profit_share {
        validate!(
            profit_share < vault.profit_share,
            ErrorCode::InvalidVaultUpdate,
            "new profit share must be less than existing profit share"
        )?;
        vault.profit_share = profit_share;
    }

    if let Some(hurdle_rate) = params.hurdle_rate {
        validate!(
            hurdle_rate < vault.hurdle_rate,
            ErrorCode::InvalidVaultUpdate,
            "new hurdle rate must be less than existing hurdle rate"
        )?;
        vault.hurdle_rate = hurdle_rate;
    }

    if let Some(permissioned) = params.permissioned {
        vault.permissioned = permissioned;
    }

    drop(vault);

    Ok(())
}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub struct UpdateVaultParams {
    pub redeem_period: Option<i64>,
    pub max_tokens: Option<u64>,
    pub management_fee: Option<i64>,
    pub min_deposit_amount: Option<u64>,
    pub profit_share: Option<u32>,
    pub hurdle_rate: Option<u32>,
    pub permissioned: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateVault<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
}
