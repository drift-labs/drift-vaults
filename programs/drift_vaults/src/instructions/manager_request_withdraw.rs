use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::state::user::User;

use crate::constraints::{is_manager_for_vault, is_user_for_vault, is_user_stats_for_vault};
use crate::state::VaultProtocolProvider;
use crate::AccountMapProvider;
use crate::{Vault, WithdrawUnit};

pub fn manager_request_withdraw<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ManagerRequestWithdraw<'info>>,
    withdraw_amount: u64,
    withdraw_unit: WithdrawUnit,
) -> Result<()> {
    let clock = &Clock::get()?;
    let mut vault = ctx.accounts.vault.load_mut()?;
    let now = clock.unix_timestamp;

    // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
    let mut vp = ctx.vault_protocol();
    vault.validate_vault_protocol(&vp)?;
    let mut vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

    let user = ctx.accounts.drift_user.load()?;
    let spot_market_index = vault.spot_market_index;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(spot_market_index), vp.is_some())?;

    let vault_equity =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    vault.manager_request_withdraw(&mut vp, withdraw_amount, withdraw_unit, vault_equity, now)?;

    Ok(())
}

#[derive(Accounts)]
pub struct ManagerRequestWithdraw<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    #[account(
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    pub drift_state: AccountInfo<'info>,
}
