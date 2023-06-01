use anchor_lang::prelude::*;
use instructions::*;
use state::*;

mod error;
mod instructions;
mod state;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod drift_vaults {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, name: [u8; 32]) -> Result<()> {
        instructions::initialize_vault(ctx, name)
    }
}
