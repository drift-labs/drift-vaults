use crate::Vault;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

pub fn transfer_with_signer_seeds<'info>(
    amount: u64,
    name: [u8; 32],
    bump: u8,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<()> {
    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    let signers = &[&signature_seeds[..]];

    let cpi_accounts = Transfer {
        from,
        to,
        authority,
    };

    let cpi_context = CpiContext::new_with_signer(token_program, cpi_accounts, signers);

    token::transfer(cpi_context, amount)?;

    Ok(())
}
