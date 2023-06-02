use crate::error::ErrorCode;
use crate::Size;
use anchor_lang::prelude::*;

use crate::math_error;
use crate::safe_decrement;
use crate::safe_increment;
use crate::state::vault::Vault;
use crate::validate;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(Eq, PartialEq, Debug)]
#[repr(C)]
pub struct VaultDepositor {
    /// The vault deposited into
    pub vault: Pubkey,
    /// The vault depositor account's pubkey. It is a pda of vault and authority
    pub pubkey: Pubkey,
    /// The authority is the address w permission to deposit/withdraw
    pub authority: Pubkey,

    vault_shares: u128,
    pub vault_shares_base: u128, // exponent for vault_shares decimal places (for rebase)

    pub last_withdraw_request_shares: u128, // get zero as 0 when not in escrow
    pub last_withdraw_request_value: u64,
    pub last_withdraw_request_ts: i64,
    pub last_valid_ts: i64,

    pub cost_basis: i64,
}

impl Size for VaultDepositor {
    const SIZE: usize = 176;
}

// const_assert_eq!(
//     VaultDepositor::SIZE,
//     std::mem::size_of::<VaultDepositor>() + 8
// );

impl VaultDepositor {
    fn validate_base(&self, vault: &Vault) -> Result<()> {
        validate!(
            self.vault_shares_base == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor bases mismatch. user base: {} vault base {}",
            self.vault_shares_base,
            vault.shares_base
        )?;

        Ok(())
    }

    pub fn checked_vault_shares(&self, vault: &Vault) -> Result<u128> {
        self.validate_base(vault)?;
        Ok(self.vault_shares)
    }

    pub fn unchecked_vault_shares(&self) -> u128 {
        self.vault_shares
    }

    pub fn increase_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        safe_increment!(self.vault_shares, delta);
        Ok(())
    }

    pub fn decrease_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        safe_decrement!(self.vault_shares, delta);
        Ok(())
    }

    pub fn update_vault_shares(&mut self, new_shares: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = new_shares;

        Ok(())
    }
}
