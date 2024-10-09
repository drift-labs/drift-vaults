use anchor_lang::prelude::*;
use drift::state::spot_market::SpotMarket;

use crate::state::VaultProtocol;
use crate::{Vault, VaultDepositor};

pub fn is_vault_for_vault_depositor(
    vault_depositor: &AccountLoader<VaultDepositor>,
    vault: &AccountLoader<Vault>,
) -> Result<bool> {
    Ok(vault_depositor.load()?.vault.eq(&vault.key()))
}

pub fn is_authority_for_vault_depositor(
    vault_depositor: &AccountLoader<VaultDepositor>,
    signer: &Signer,
) -> Result<bool> {
    Ok(vault_depositor.load()?.authority.eq(signer.key))
}

pub fn is_manager_for_vault(vault: &AccountLoader<Vault>, signer: &Signer) -> Result<bool> {
    Ok(vault.load()?.manager.eq(signer.key))
}

pub fn is_protocol_for_vault(
    vault: &AccountLoader<Vault>,
    vault_protocol: &AccountLoader<VaultProtocol>,
    signer: &Signer,
) -> Result<bool> {
    let vault_ref = vault.load()?;
    let vp_key = vault_protocol.key();
    if vault_ref.vault_protocol {
        let (expected, _) =
            Pubkey::find_program_address(&[b"vault_protocol", vault.key().as_ref()], &crate::id());
        Ok(vp_key.eq(&expected) && vault_protocol.load()?.protocol.eq(signer.key))
    } else {
        // Vault does not have VaultProtocol, but rem accts provided one
        let ec = crate::error::ErrorCode::VaultProtocolMissing;
        msg!("Error {} thrown at {}:{}", ec, file!(), line!());
        msg!("Vault does not have VaultProtocol");
        Err(anchor_lang::error::Error::from(ec))
    }
}

pub fn is_delegate_for_vault(vault: &AccountLoader<Vault>, signer: &Signer) -> Result<bool> {
    Ok(vault.load()?.delegate.eq(signer.key))
}

pub fn is_user_for_vault(vault: &AccountLoader<Vault>, user_key: &Pubkey) -> Result<bool> {
    Ok(vault.load()?.user.eq(user_key))
}

pub fn is_user_stats_for_vault(
    vault: &AccountLoader<Vault>,
    user_stats: &AccountInfo,
) -> Result<bool> {
    Ok(vault.load()?.user_stats.eq(user_stats.key))
}

pub fn is_spot_market_for_vault(
    vault: &AccountLoader<Vault>,
    drift_spot_market: &AccountLoader<SpotMarket>,
    market_index: u16,
) -> Result<bool> {
    Ok(
        (vault.load()?.spot_market_index).eq(&drift_spot_market.load()?.market_index)
            && (vault.load()?.spot_market_index).eq(&market_index),
    )
}

pub fn is_vault_protocol_for_vault(
    vault_protocol: &AccountLoader<VaultProtocol>,
    vault: &AccountLoader<Vault>,
) -> Result<bool> {
    let vault_ref = vault.load()?;
    let vp_key = vault_protocol.key();
    if vault_ref.vault_protocol {
        let (expected, _) =
            Pubkey::find_program_address(&[b"vault_protocol", vault.key().as_ref()], &crate::id());
        Ok(vp_key.eq(&expected))
    } else {
        // Vault does not have VaultProtocol, but rem accts provided one
        let ec = crate::error::ErrorCode::VaultProtocolMissing;
        msg!("Error {} thrown at {}:{}", ec, file!(), line!());
        msg!("Vault does not have VaultProtocol");
        Err(anchor_lang::error::Error::from(ec))
    }
}
