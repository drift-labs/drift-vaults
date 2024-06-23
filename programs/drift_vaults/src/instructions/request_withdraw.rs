use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::math::casting::Cast;
use drift::state::user::User;

use crate::{VaultDepositor, WithdrawUnit};
use crate::constraints::{
  is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::state::{Vault, VaultProtocolProvider};
use crate::state::account_maps::AccountMapProvider;

pub fn request_withdraw<'c: 'info, 'info>(
  ctx: Context<'_, '_, 'c, 'info, RequestWithdraw<'info>>,
  withdraw_amount: u64,
  withdraw_unit: WithdrawUnit,
) -> Result<()> {
  let clock = &Clock::get()?;
  let vault = &mut ctx.accounts.vault.load_mut()?;
  let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

  let user = ctx.accounts.drift_user.load()?;

  let mut vp = ctx.vault_protocol();
  let mut vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

  let AccountMaps {
    perp_market_map,
    spot_market_map,
    mut oracle_map,
  } = ctx.load_maps(clock.slot, None, vp.is_some())?;

  let vault_equity = vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;


  vault_depositor.request_withdraw(
    withdraw_amount.cast()?,
    withdraw_unit,
    vault_equity,
    vault,
    &mut vp,
    clock.unix_timestamp,
  )?;

  Ok(())
}

#[derive(Accounts)]
pub struct RequestWithdraw<'info> {
  #[account(mut)]
  pub vault: AccountLoader<'info, Vault>,
  #[account(mut,
  seeds = [b"vault_depositor", vault.key().as_ref(), authority.key().as_ref()],
  bump,
  constraint = is_authority_for_vault_depositor(& vault_depositor, & authority) ?,)]
  pub vault_depositor: AccountLoader<'info, VaultDepositor>,
  pub authority: Signer<'info>,
  #[account(constraint = is_user_stats_for_vault(& vault, & drift_user_stats) ?)]
  /// CHECK: checked in drift cpi
  pub drift_user_stats: AccountInfo<'info>,
  #[account(constraint = is_user_for_vault(& vault, & drift_user.key()) ?)]
  /// CHECK: checked in drift cpi
  pub drift_user: AccountLoader<'info, User>,
  /// CHECK: checked in drift cpi
  pub drift_state: AccountInfo<'info>,
}
