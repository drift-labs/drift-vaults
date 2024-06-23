use anchor_lang::prelude::*;

use crate::{error::ErrorCode, validate};
use crate::constraints::is_manager_for_vault;
use crate::state::{Vault, VaultProtocolProvider};

pub fn update_vault<'c: 'info, 'info>(
  ctx: Context<'_, '_, 'c, 'info, UpdateVault<'info>>,
  params: UpdateVaultParams,
) -> Result<()> {
  let mut vault = ctx.accounts.vault.load_mut()?;

  // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
  let mut vp = ctx.vault_protocol();
  let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

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

  if let (Some(mut vp), Some(vp_params)) = (vp, params.vault_protocol) {
    if let Some(new_protocol_fee) = vp_params.protocol_fee {
      validate!(
              new_protocol_fee < vp.protocol_fee,
              ErrorCode::InvalidVaultUpdate,
              "new protocol fee must be less than existing protocol fee"
          )?;
      vp.protocol_fee = new_protocol_fee;
    }

    if let Some(new_protocol_profit_share) = vp_params.protocol_profit_share {
      validate!(
            new_protocol_profit_share < vp.protocol_profit_share,
            ErrorCode::InvalidVaultUpdate,
            "new protocol profit share must be less than existing protocol profit share"
        )?;
      vp.protocol_profit_share = new_protocol_profit_share;
    }
  }

  if let Some(manager_profit_share) = params.manager_profit_share {
    validate!(
            manager_profit_share < vault.manager_profit_share,
            ErrorCode::InvalidVaultUpdate,
            "new manager profit share must be less than existing manager profit share"
        )?;
    vault.manager_profit_share = manager_profit_share;
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
  pub manager_profit_share: Option<u32>,
  pub hurdle_rate: Option<u32>,
  pub permissioned: Option<bool>,
  // todo: check old clients default to None here upon serialization
  pub vault_protocol: Option<UpdateVaultProtocolParams>,
}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub struct UpdateVaultProtocolParams {
  pub protocol_fee: Option<u64>,
  pub protocol_profit_share: Option<u32>,
}

#[derive(Accounts)]
pub struct UpdateVault<'info> {
  #[account(mut,
  constraint = is_manager_for_vault(& vault, & manager) ?,)]
  pub vault: AccountLoader<'info, Vault>,
  pub manager: Signer<'info>,
}
