use crate::constraints::{is_manager_for_vault, is_spot_market_for_vault, is_user_stats_for_vault};
use crate::cpi::RequestRemoveInsuranceFundStakeCPI;
use crate::declare_vault_seeds;
use crate::Vault;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use drift::cpi::accounts::RequestRemoveInsuranceFundStake as DriftRequestRemoveInsuranceFundStake;
use drift::program::Drift;
use drift::state::insurance_fund_stake::InsuranceFundStake;
use drift::state::spot_market::SpotMarket;

pub fn request_remove_insurance_fund_stake<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestRemoveInsuranceFundStake<'info>>,
    market_index: u16,
    amount: u64,
) -> Result<()> {
    ctx.drift_request_remove_insurance_fund_stake(market_index, amount)?;
    Ok(())
}

pub fn cancel_request_remove_insurance_fund_stake<'info>(
    ctx: Context<'_, '_, '_, 'info, RequestRemoveInsuranceFundStake<'info>>,
    market_index: u16,
) -> Result<()> {
    ctx.drift_cancel_request_remove_insurance_fund_stake(market_index)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct RequestRemoveInsuranceFundStake<'info> {
    #[account(
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        constraint = is_spot_market_for_vault(&vault, &drift_spot_market, market_index)?,
    )]
    pub drift_spot_market: AccountLoader<'info, SpotMarket>,
    #[account(
        mut,
        seeds = [b"insurance_fund_stake", vault.key().as_ref(), market_index.to_le_bytes().as_ref()],
        bump
    )]
    pub insurance_fund_stake: AccountLoader<'info, InsuranceFundStake>,
    #[account(
        mut,
        seeds = [b"insurance_fund_vault".as_ref(), market_index.to_le_bytes().as_ref()],
        bump,
    )]
    pub insurance_fund_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = is_user_stats_for_vault(&vault, &drift_user_stats)?
    )]
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
}

impl<'info> RequestRemoveInsuranceFundStakeCPI
    for Context<'_, '_, '_, 'info, RequestRemoveInsuranceFundStake<'info>>
{
    fn drift_request_remove_insurance_fund_stake(
        &self,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        declare_vault_seeds!(self.accounts.vault, seeds);

        let cpi_accounts = DriftRequestRemoveInsuranceFundStake {
            spot_market: self.accounts.drift_spot_market.to_account_info().clone(),
            insurance_fund_stake: self.accounts.insurance_fund_stake.to_account_info().clone(),
            user_stats: self.accounts.drift_user_stats.to_account_info().clone(),
            insurance_fund_vault: self.accounts.insurance_fund_vault.to_account_info().clone(),
            authority: self.accounts.vault.to_account_info().clone(),
        };

        let drift_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds)
            .with_remaining_accounts(self.remaining_accounts.into());
        drift::cpi::request_remove_insurance_fund_stake(cpi_context, market_index, amount)?;

        Ok(())
    }

    fn drift_cancel_request_remove_insurance_fund_stake(&self, market_index: u16) -> Result<()> {
        declare_vault_seeds!(self.accounts.vault, seeds);

        let cpi_accounts = DriftRequestRemoveInsuranceFundStake {
            spot_market: self.accounts.drift_spot_market.to_account_info().clone(),
            insurance_fund_stake: self.accounts.insurance_fund_stake.to_account_info().clone(),
            user_stats: self.accounts.drift_user_stats.to_account_info().clone(),
            insurance_fund_vault: self.accounts.insurance_fund_vault.to_account_info().clone(),
            authority: self.accounts.vault.to_account_info().clone(),
        };

        let drift_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds)
            .with_remaining_accounts(self.remaining_accounts.into());
        drift::cpi::cancel_request_remove_insurance_fund_stake(cpi_context, market_index)?;

        Ok(())
    }
}
