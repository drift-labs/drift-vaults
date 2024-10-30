use anchor_lang::prelude::*;
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::user::User;

use crate::constraints::{
    is_delegate_for_vault, is_manager_for_vault, is_user_for_vault, is_user_stats_for_vault,
    is_vault_for_vault_depositor,
};
use crate::events::{VaultDepositorAction, VaultDepositorRecord, VaultDepositorV1Record};
use crate::state::{Vault, VaultProtocolProvider};
use crate::{AccountMapProvider, VaultFee};
use crate::{VaultDepositor, VaultDepositorBase};

pub fn apply_profit_share<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ApplyProfitShare<'info>>,
) -> Result<()> {
    let clock = &Clock::get()?;
    let now = clock.unix_timestamp;

    let mut vault = ctx.accounts.vault.load_mut()?;
    let mut vault_depositor = ctx.accounts.vault_depositor.load_mut()?;

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

    let vault_shares_before = vault_depositor.checked_vault_shares(&vault)?;
    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;
    let protocol_shares_before = vault.get_protocol_shares(&mut vp);

    let VaultFee {
        management_fee_payment,
        management_fee_shares,
        protocol_fee_payment,
        protocol_fee_shares,
    } = vault.apply_fee(&mut vp, vault_equity, now)?;
    let (manager_profit_share, protocol_profit_share) =
        vault_depositor.apply_profit_share(vault_equity, &mut vault, &mut vp)?;

    let protocol_shares_after = vault.get_protocol_shares(&mut vp);

    match vp {
        None => {
            emit!(VaultDepositorRecord {
                ts: now,
                vault: vault.pubkey,
                depositor_authority: vault_depositor.authority,
                action: VaultDepositorAction::FeePayment,
                amount: 0,
                spot_market_index: vault.spot_market_index,
                vault_equity_before: vault_equity,
                vault_shares_before,
                user_vault_shares_before,
                total_vault_shares_before,
                vault_shares_after: vault_depositor.get_vault_shares(),
                total_vault_shares_after: vault.total_shares,
                user_vault_shares_after: vault.user_shares,
                profit_share: manager_profit_share,
                management_fee: management_fee_payment,
                management_fee_shares,
            });
        }
        Some(_) => {
            emit!(VaultDepositorV1Record {
                ts: now,
                vault: vault.pubkey,
                depositor_authority: vault_depositor.authority,
                action: VaultDepositorAction::FeePayment,
                amount: 0,
                spot_market_index: vault.spot_market_index,
                vault_equity_before: vault_equity,
                vault_shares_before,
                user_vault_shares_before,
                total_vault_shares_before,
                vault_shares_after: vault_depositor.get_vault_shares(),
                total_vault_shares_after: vault.total_shares,
                user_vault_shares_after: vault.user_shares,
                protocol_profit_share,
                protocol_fee: protocol_fee_payment,
                protocol_fee_shares,
                manager_profit_share,
                management_fee: management_fee_payment,
                management_fee_shares,
                protocol_shares_before,
                protocol_shares_after,
            });
        }
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ApplyProfitShare<'info> {
    #[account(
        mut,
        constraint = is_manager_for_vault(&vault, &manager)? || is_delegate_for_vault(&vault, &manager)?
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
        mut,
        constraint = is_vault_for_vault_depositor(&vault_depositor, &vault)?
    )]
    pub vault_depositor: AccountLoader<'info, VaultDepositor>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    #[account(
        mut,
        constraint = is_user_for_vault(&vault, &drift_user.key())?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    pub drift_state: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    pub drift_signer: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
}
