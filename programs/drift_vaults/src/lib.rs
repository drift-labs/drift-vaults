use anchor_lang::prelude::*;
use instructions::*;
// use share_math::*;
use state::*;

mod error;
mod instructions;
pub mod macros;
mod state;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod drift_vaults {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        name: [u8; 32],
        spot_market_index: u16,
    ) -> Result<()> {
        instructions::initialize_vault(ctx, name, spot_market_index)
    }

    pub fn initialize_vault_depositor(ctx: Context<InitializeVaultDepositor>) -> Result<()> {
        instructions::initialize_vault_depositor(ctx)
    }

    pub fn deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::withdraw(ctx, amount)
    }
}
