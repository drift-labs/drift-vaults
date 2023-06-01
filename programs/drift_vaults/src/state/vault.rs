use crate::Size;
use anchor_lang::prelude::*;

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
    /// The drift user stats account for the vault
    pub user_stats: Pubkey,
    /// The drift user account for the vault
    pub user: Pubkey,
    /// The bump for the vault pda
    pub bump: u8,
}

impl Size for Vault {
    const SIZE: usize = 169;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn impl_size() {
        assert_eq!(super::Vault::SIZE, std::mem::size_of::<Vault>() + 8)
    }
}
