use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::math::casting::Cast;
use drift::state::user::User;

use crate::AccountMapProvider;
use crate::constraints::{is_manager_for_vault, is_user_for_vault, is_user_stats_for_vault};
use crate::state::{Vault, VaultProtocolProvider};

pub fn manager_cancel_withdraw_request<'c: 'info, 'info>(
  ctx: Context<'_, '_, 'c, 'info, ManagerCancelWithdrawRequest<'info>>,
) -> Result<()> {
  let clock = &Clock::get()?;
  let vault = &mut ctx.accounts.vault.load_mut()?;

  // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
  let mut vp = ctx.vault_protocol();
  let mut vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

  let user = ctx.accounts.drift_user.load()?;

  let AccountMaps {
    perp_market_map,
    spot_market_map,
    mut oracle_map,
  } = ctx.load_maps(clock.slot, None, vp.is_some())?;

  let vault_equity = vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

  vault.manager_cancel_withdraw_request(&mut vp, vault_equity.cast()?, clock.unix_timestamp)?;

  Ok(())
}

#[derive(Accounts)]
pub struct ManagerCancelWithdrawRequest<'info> {
  #[account(mut,
  constraint = is_manager_for_vault(& vault, & manager) ?)]
  pub vault: AccountLoader<'info, Vault>,
  pub manager: Signer<'info>,
  #[account(constraint = is_user_stats_for_vault(& vault, & drift_user_stats) ?)]
  /// CHECK: checked in drift cpi
  pub drift_user_stats: AccountInfo<'info>,
  #[account(constraint = is_user_for_vault(& vault, & drift_user.key()) ?)]
  /// CHECK: checked in drift cpi
  pub drift_user: AccountLoader<'info, User>,
  /// CHECK: checked in drift cpi
  pub drift_state: AccountInfo<'info>,
}
