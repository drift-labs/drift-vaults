use anchor_lang::prelude::*;
use instructions::*;
use state::*;

mod constants;
mod cpi;
mod error;
mod instructions;
pub mod macros;
mod state;
mod tests;

declare_id!("VAULtLeTwwUxpwAw98E6XmgaDeQucKgV5UaiAuQ655D");

#[program]
pub mod drift_vaults {
    use super::*;

    pub fn initialize_vault<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeVault<'info>>,
        params: VaultParams,
    ) -> Result<()> {
        instructions::initialize_vault(ctx, params)
    }

    pub fn update_delegate<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateDelegate<'info>>,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::update_delegate(ctx, delegate)
    }

    pub fn update_vault<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateVault<'info>>,
        params: UpdateVaultParams,
    ) -> Result<()> {
        instructions::update_vault(ctx, params)
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

    pub fn liquidate<'info>(ctx: Context<'_, '_, '_, 'info, Liquidate<'info>>) -> Result<()> {
        instructions::liquidate(ctx)
    }

    pub fn reset_delegate<'info>(
        ctx: Context<'_, '_, '_, 'info, ResetDelegate<'info>>,
    ) -> Result<()> {
        instructions::reset_delegate(ctx)
    }

    pub fn manager_deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagerDeposit<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::manager_deposit(ctx, amount)
    }

    pub fn manager_request_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagerRequestWithdraw<'info>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::manager_request_withdraw(ctx, withdraw_amount, withdraw_unit)
    }

    pub fn manger_cancel_withdraw_request<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagerCancelWithdrawRequest<'info>>,
    ) -> Result<()> {
        instructions::manager_cancel_withdraw_request(ctx)
    }

    pub fn manager_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, ManagerWithdraw<'info>>,
    ) -> Result<()> {
        instructions::manager_withdraw(ctx)
    }

    pub fn apply_profit_share<'info>(
        ctx: Context<'_, '_, '_, 'info, ApplyProfitShare<'info>>,
    ) -> Result<()> {
        instructions::apply_profit_share(ctx)
    }

    pub fn force_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, ForceWithdraw<'info>>,
    ) -> Result<()> {
        instructions::force_withdraw(ctx)
    }
}
