use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::math::casting::Cast;
use drift::state::user::User;

use crate::AccountMapProvider;
use crate::constraints::{
  is_authority_for_vault_depositor, is_user_for_vault, is_user_stats_for_vault,
};
use crate::state::{Vault, VaultProtocolProvider};
use crate::VaultDepositor;

pub fn cancel_withdraw_request<'c: 'info, 'info>(
  ctx: Context<'_, '_, 'c, 'info, CancelWithdrawRequest<'info>>,
) -> Result<()> {
  let clock = &Clock::get()?;
  let mut vault = ctx.accounts.vault.load_mut()?;
  let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

  // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
  let mut vp = ctx.vault_protocol();
  let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

  let user = ctx.accounts.drift_user.load()?;

  let AccountMaps {
    perp_market_map,
    spot_market_map,
    mut oracle_map,
  } = ctx.load_maps(clock.slot, None, vp.is_some())?;

  let vault_equity = vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

  match vp {
    None => vault_depositor.cancel_withdraw_request(vault_equity.cast()?, &mut vault, &mut None, clock.unix_timestamp)?,
    Some(vp) => vault_depositor.cancel_withdraw_request(vault_equity.cast()?, &mut vault, &mut Some(vp), clock.unix_timestamp)?
  };

  Ok(())
}

#[derive(Accounts)]
pub struct CancelWithdrawRequest<'info> {
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
