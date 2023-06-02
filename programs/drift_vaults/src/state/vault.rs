use crate::Size;
use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(Eq, PartialEq, Debug)]
#[repr(C)]
pub struct Vault {
    /// The name of the vault. Vault pubkey is derived from this name.
    pub name: [u8; 32],
    /// The vault's pubkey. It is a pda of name and also used as the authority for drift user
    pub pubkey: Pubkey,
    /// The authority of the vault who has ability to update vault params
    pub authority: Pubkey,
    /// The vaults token account. Used to receive tokens between deposits and withdrawals
    pub token_account: Pubkey,
    /// The drift user stats account for the vault
    pub user_stats: Pubkey,
    /// The drift user account for the vault
    pub user: Pubkey,
    /// The spot market index the vault deposits into/withdraws from
    pub spot_market_index: u16,
    /// The bump for the vault pda
    pub bump: u8,
    pub padding: [u8; 1],

    pub shares_base: u128,
    pub total_shares: u128,
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 228;
}

// const_assert_eq!(Vault::SIZE, std::mem::size_of::<Vault>() + 8);
