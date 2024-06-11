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

declare_id!("vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR");

#[program]
pub mod drift_vaults {
    use super::*;

    pub fn initialize_vault<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeVault<'info>>,
        params: VaultParams,
    ) -> Result<()> {
        instructions::initialize_vault(ctx, params)
    }

    pub fn update_delegate<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateDelegate<'info>>,
        delegate: Pubkey,
    ) -> Result<()> {
        instructions::update_delegate(ctx, delegate)
    }

    pub fn update_margin_trading_enabled<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateMarginTradingEnabled<'info>>,
        enabled: bool,
    ) -> Result<()> {
        instructions::update_margin_trading_enabled(ctx, enabled)
    }

    pub fn update_vault<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateVault<'info>>,
        params: UpdateVaultParams,
    ) -> Result<()> {
        instructions::update_vault(ctx, params)
    }

    pub fn initialize_vault_depositor(ctx: Context<InitializeVaultDepositor>) -> Result<()> {
        instructions::initialize_vault_depositor(ctx)
    }

    pub fn deposit<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, Deposit<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::deposit(ctx, amount)
    }

    pub fn request_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, RequestWithdraw<'info>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::request_withdraw(ctx, withdraw_amount, withdraw_unit)
    }

    pub fn cancel_request_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, CancelWithdrawRequest<'info>>,
    ) -> Result<()> {
        instructions::cancel_withdraw_request(ctx)
    }

    pub fn withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, Withdraw<'info>>,
    ) -> Result<()> {
        instructions::withdraw(ctx)
    }

    pub fn liquidate<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, Liquidate<'info>>,
    ) -> Result<()> {
        instructions::liquidate(ctx)
    }

    pub fn reset_delegate<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ResetDelegate<'info>>,
    ) -> Result<()> {
        instructions::reset_delegate(ctx)
    }

    pub fn manager_deposit<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerDeposit<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::manager_deposit(ctx, amount)
    }

    pub fn manager_request_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerRequestWithdraw<'info>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::manager_request_withdraw(ctx, withdraw_amount, withdraw_unit)
    }

    pub fn manger_cancel_withdraw_request<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerCancelWithdrawRequest<'info>>,
    ) -> Result<()> {
        instructions::manager_cancel_withdraw_request(ctx)
    }

    pub fn manager_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerWithdraw<'info>>,
    ) -> Result<()> {
        instructions::manager_withdraw(ctx)
    }

    pub fn apply_profit_share<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ApplyProfitShare<'info>>,
    ) -> Result<()> {
        instructions::apply_profit_share(ctx)
    }

    pub fn force_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ForceWithdraw<'info>>,
    ) -> Result<()> {
        instructions::force_withdraw(ctx)
    }

    pub fn initialize_insurance_fund_stake<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeInsuranceFundStake<'info>>,
        market_index: u16,
    ) -> Result<()> {
        instructions::initialize_insurance_fund_stake(ctx, market_index)
    }

    pub fn initialize_competitor<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeCompetitor<'info>>,
    ) -> Result<()> {
        instructions::initialize_competitor(ctx)
    }
}
