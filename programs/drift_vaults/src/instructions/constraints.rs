use crate::{Vault, VaultDepositor};

use anchor_lang::prelude::*;

pub fn is_vault_for_vault_depositor(
    vault_depositor: &AccountLoader<VaultDepositor>,
    vault: &AccountLoader<Vault>,
) -> anchor_lang::Result<bool> {
    Ok(vault_depositor.load()?.vault.eq(&vault.key()))
}

pub fn is_authority_for_vault_depositor(
    vault_depositor: &AccountLoader<VaultDepositor>,
    signer: &Signer,
) -> anchor_lang::Result<bool> {
    Ok(vault_depositor.load()?.authority.eq(signer.key))
}

pub fn is_manager_for_vault(
    vault: &AccountLoader<Vault>,
    signer: &Signer,
) -> anchor_lang::Result<bool> {
    Ok(vault.load()?.manager.eq(signer.key))
}

pub fn is_user_for_vault(
    vault_depositor: &AccountLoader<Vault>,
    user_key: &Pubkey,
) -> anchor_lang::Result<bool> {
    Ok(vault_depositor.load()?.user.eq(user_key))
}

pub fn is_user_stats_for_vault(
    vault_depositor: &AccountLoader<Vault>,
    user_stats: &AccountInfo,
) -> anchor_lang::Result<bool> {
    Ok(vault_depositor.load()?.user_stats.eq(user_stats.key))
}
