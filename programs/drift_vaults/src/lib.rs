use anchor_lang::prelude::*;
use instructions::*;
use state::*;

mod constants;
mod drift_cpi;
mod error;
mod instructions;
pub mod macros;
pub mod state;
#[cfg(test)]
mod test_utils;
#[cfg(test)]
mod tests;
mod token_cpi;

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

    pub fn initialize_vault_with_protocol<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeVaultWithProtocol<'info>>,
        params: VaultWithProtocolParams,
    ) -> Result<()> {
        instructions::initialize_vault_with_protocol(ctx, params)
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

    pub fn update_user_pool_id<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdatePoolId<'info>>,
        pool_id: u8,
    ) -> Result<()> {
        instructions::update_pool_id(ctx, pool_id)
    }

    pub fn update_vault_protocol<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateVaultProtocol<'info>>,
        params: UpdateVaultProtocolParams,
    ) -> Result<()> {
        instructions::update_vault_protocol(ctx, params)
    }

    pub fn update_vault<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateVault<'info>>,
        params: UpdateVaultParams,
    ) -> Result<()> {
        instructions::update_vault(ctx, params)
    }

    pub fn update_vault_manager<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateVault<'info>>,
        manager: Pubkey,
    ) -> Result<()> {
        instructions::update_vault_manager(ctx, manager)
    }

    pub fn update_cumulative_fuel_amount<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateCumulativeFuelAmount<'info>>,
    ) -> Result<()> {
        instructions::update_cumulative_fuel_amount(ctx)
    }

    pub fn initialize_vault_depositor(ctx: Context<InitializeVaultDepositor>) -> Result<()> {
        instructions::initialize_vault_depositor(ctx)
    }

    pub fn initialize_tokenized_vault_depositor(
        ctx: Context<InitializeTokenizedVaultDepositor>,
        params: InitializeTokenizedVaultDepositorParams,
    ) -> Result<()> {
        instructions::initialize_tokenized_vault_depositor(ctx, params)
    }

    pub fn tokenize_shares<'info>(
        ctx: Context<'_, '_, 'info, 'info, TokenizeShares<'info>>,
        amount: u64,
        unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::tokenize_shares(ctx, amount, unit)
    }

    pub fn redeem_tokens<'info>(
        ctx: Context<'_, '_, 'info, 'info, RedeemTokens<'info>>,
        tokens_to_burn: u64,
    ) -> Result<()> {
        instructions::redeem_tokens(ctx, tokens_to_burn)
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

    pub fn reset_fuel_season<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ResetFuelSeason<'info>>,
    ) -> Result<()> {
        instructions::reset_fuel_season(ctx)
    }

    pub fn reset_vault_fuel_season<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ResetVaultFuelSeason<'info>>,
    ) -> Result<()> {
        instructions::reset_vault_fuel_season(ctx)
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

    pub fn manager_update_fuel_distribution_mode<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerUpdateFuelDistributionMode<'info>>,
        fuel_distribution_mode: u8,
    ) -> Result<()> {
        instructions::manager_update_fuel_distribution_mode(ctx, fuel_distribution_mode)
    }

    pub fn admin_init_fee_update<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, AdminInitFeeUpdate<'info>>,
    ) -> Result<()> {
        instructions::admin_init_fee_update(ctx)
    }

    pub fn admin_delete_fee_update<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, AdminDeleteFeeUpdate<'info>>,
    ) -> Result<()> {
        instructions::admin_delete_fee_update(ctx)
    }

    pub fn manager_update_fees<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ManagerUpdateFees<'info>>,
        params: ManagerUpdateFeesParams,
    ) -> Result<()> {
        instructions::manager_update_fees(ctx, params)
    }

    pub fn apply_profit_share<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ApplyProfitShare<'info>>,
    ) -> Result<()> {
        instructions::apply_profit_share(ctx)
    }

    pub fn apply_rebase<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ApplyRebase<'info>>,
    ) -> Result<()> {
        instructions::apply_rebase(ctx)
    }

    pub fn apply_rebase_tokenized_depositor<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ApplyRebaseTokenizedDepositor<'info>>,
    ) -> Result<()> {
        instructions::apply_rebase_tokenized_depositor(ctx)
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

    pub fn add_insurance_fund_stake<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, AddInsuranceFundStake<'info>>,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        instructions::add_insurance_fund_stake(ctx, market_index, amount)
    }

    pub fn request_remove_insurance_fund_stake<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, RequestRemoveInsuranceFundStake<'info>>,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        instructions::request_remove_insurance_fund_stake(ctx, market_index, amount)
    }

    pub fn remove_insurance_fund_stake<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, RemoveInsuranceFundStake<'info>>,
        market_index: u16,
    ) -> Result<()> {
        instructions::remove_insurance_fund_stake(ctx, market_index)
    }

    pub fn cancel_request_remove_insurance_fund_stake<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, RequestRemoveInsuranceFundStake<'info>>,
        market_index: u16,
    ) -> Result<()> {
        instructions::cancel_request_remove_insurance_fund_stake(ctx, market_index)
    }

    pub fn protocol_request_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ProtocolRequestWithdraw<'info>>,
        withdraw_amount: u64,
        withdraw_unit: WithdrawUnit,
    ) -> Result<()> {
        instructions::protocol_request_withdraw(ctx, withdraw_amount, withdraw_unit)
    }

    pub fn protocol_cancel_withdraw_request<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ProtocolCancelWithdrawRequest<'info>>,
    ) -> Result<()> {
        instructions::protocol_cancel_withdraw_request(ctx)
    }

    pub fn protocol_withdraw<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ProtocolWithdraw<'info>>,
    ) -> Result<()> {
        instructions::protocol_withdraw(ctx)
    }
}
