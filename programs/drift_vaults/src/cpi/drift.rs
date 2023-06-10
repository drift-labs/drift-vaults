use crate::Vault;
use anchor_lang::prelude::AccountInfo;
use anchor_lang::prelude::*;
use drift::cpi::accounts::{UpdateUser, Withdraw};

#[allow(clippy::too_many_arguments)]
pub fn withdraw<'a>(
    spot_market_index: u16,
    amount: u64,
    name: [u8; 32],
    bump: u8,
    drift_program: AccountInfo<'a>,
    drift_state: AccountInfo<'a>,
    drift_user: AccountInfo<'a>,
    drift_user_stats: AccountInfo<'a>,
    vault: AccountInfo<'a>,
    drift_spot_market_vault: AccountInfo<'a>,
    drift_signer: AccountInfo<'a>,
    vault_token_account: AccountInfo<'a>,
    token_program: AccountInfo<'a>,
    remaining_accounts: Vec<AccountInfo<'a>>,
) -> Result<()> {
    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    let signers = &[&signature_seeds[..]];

    let cpi_accounts = Withdraw {
        state: drift_state,
        user: drift_user,
        user_stats: drift_user_stats,
        authority: vault,
        spot_market_vault: drift_spot_market_vault,
        drift_signer,
        user_token_account: vault_token_account,
        token_program,
    };
    let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, signers)
        .with_remaining_accounts(remaining_accounts);
    drift::cpi::withdraw(cpi_context, spot_market_index, amount, false)?;

    Ok(())
}

pub fn update_user_delegate<'a>(
    delegate: Pubkey,
    name: [u8; 32],
    bump: u8,
    drift_program: AccountInfo<'a>,
    drift_user: AccountInfo<'a>,
    vault: AccountInfo<'a>,
) -> Result<()> {
    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    let signers = &[&signature_seeds[..]];

    let cpi_accounts = UpdateUser {
        user: drift_user,
        authority: vault,
    };
    let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, signers);
    drift::cpi::update_user_delegate(cpi_context, 0, delegate)?;

    Ok(())
}
