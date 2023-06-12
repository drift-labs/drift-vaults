use anchor_lang::prelude::*;
use instructions::*;
use state::*;

mod error;
mod instructions;
pub mod macros;
mod state;
mod tests;

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

    pub fn update_delegate<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateDelegate<'info>>,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::update_delegate(ctx, delegate)
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

    pub fn request_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, RequestWithdraw<'info>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::request_withdraw(ctx, withdraw_amount, withdraw_unit)
    }

    pub fn cancel_request_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelWithdrawRequest<'info>>,
    ) -> Result<()> {
        instructions::cancel_withdraw_request(ctx)
    }

    pub fn withdraw<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
        instructions::withdraw(ctx)
    }
}
