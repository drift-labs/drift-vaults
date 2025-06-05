use crate::constraints::{is_manager_for_vault, is_user_for_vault, is_user_stats_for_vault};
use crate::state::events::ManagerUpdateBorrowRecord;
use crate::state::{
    FeeUpdateProvider, FeeUpdateStatus, FuelOverflowProvider, VaultProtocolProvider,
};
use crate::AccountMapProvider;
use crate::{error::ErrorCode, validate, Vault};
use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::state::user::{FuelOverflowStatus, User, UserStats};

pub fn manager_update_borrow<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ManagerUpdateBorrow<'info>>,
    new_borrow_value: u64,
) -> Result<()> {
    let mut vault = ctx.accounts.vault.load_mut()?;
    validate!(
        vault.is_trusted_vault_class(),
        ErrorCode::InvalidVaultClass,
        "Only trusted vaults can have their borrow value updated"
    )?;

    let clock = &Clock::get()?;
    let now = clock.unix_timestamp;

    // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
    let mut vp = ctx.vault_protocol();
    vault.validate_vault_protocol(&vp)?;
    let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

    let user_stats = ctx.accounts.drift_user_stats.load()?;
    let has_fuel_overflow = FuelOverflowStatus::exists(user_stats.fuel_overflow_status);
    let fuel_overflow = ctx.fuel_overflow(vp.is_some(), has_fuel_overflow);
    user_stats.validate_fuel_overflow(&fuel_overflow)?;

    let has_fee_update = FeeUpdateStatus::has_pending_fee_update(vault.fee_update_status);
    let fee_update = ctx.fee_update(vp.is_some(), has_fuel_overflow, has_fee_update);
    vault.validate_fee_update(&fee_update)?;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(
        clock.slot,
        None,
        vp.is_some(),
        has_fuel_overflow,
        has_fee_update,
    )?;

    let user = ctx.accounts.drift_user.load()?;

    let vault_equity_before =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    let previous_borrow_value = vault.manager_borrowed_value;
    vault.manager_borrowed_value = new_borrow_value;

    drop(vault);
    drop(user);
    drop(user_stats);
    drop(vp);

    let vault = ctx.accounts.vault.load()?;
    let user = ctx.accounts.drift_user.load()?;

    let vault_equity_after =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    emit!(ManagerUpdateBorrowRecord {
        ts: now,
        vault: vault.pubkey,
        manager: vault.manager,
        previous_borrow_value,
        new_borrow_value: new_borrow_value,
        vault_equity_before,
        vault_equity_after,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct ManagerUpdateBorrow<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountLoader<'info, UserStats>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
}
