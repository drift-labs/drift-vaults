use crate::constraints::{is_manager_for_vault, is_spot_market_for_vault, is_user_stats_for_vault};
use crate::cpi::{AddInsuranceFundStakeCPI, WithdrawCPI};
use crate::error::ErrorCode;
use crate::Vault;
use crate::{declare_vault_seeds, implement_withdraw, validate, AccountMapProvider};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use drift::cpi::accounts::AddInsuranceFundStake as DriftAddInsuranceFundStake;
use drift::cpi::accounts::Withdraw as DriftWithdraw;
use drift::instructions::optional_accounts::AccountMaps;
use drift::program::Drift;
use drift::state::insurance_fund_stake::InsuranceFundStake;
use drift::state::spot_market::SpotMarket;
use drift::state::user::User;

pub fn add_insurance_fund_stake<'info>(
    ctx: Context<'_, '_, '_, 'info, AddInsuranceFundStake<'info>>,
    market_index: u16,
    amount: u64,
) -> Result<()> {
    let clock = &Clock::get()?;
    let vault = ctx.accounts.vault.load()?;

    let user = ctx.accounts.drift_user.load()?;
    let spot_market_index = vault.spot_market_index;

    validate!(!vault.in_liquidation(), ErrorCode::OngoingLiquidation)?;

    let AccountMaps {
        perp_market_map,
        spot_market_map,
        mut oracle_map,
    } = ctx.load_maps(clock.slot, Some(spot_market_index))?;

    let vault_equity =
        vault.calculate_equity(&user, &perp_market_map, &spot_market_map, &mut oracle_map)?;

    validate!(
        amount <= vault_equity,
        ErrorCode::InvalidAddInsuranceFundSize
    )?;

    ctx.drift_withdraw(amount)?;

    ctx.drift_add_insurance_fund_stake(market_index, amount)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct AddInsuranceFundStake<'info> {
    #[account(
        constraint = is_manager_for_vault(&vault, &manager)?,
    )]
    pub vault: AccountLoader<'info, Vault>,
    pub manager: Signer<'info>,
    #[account(
        mut,
        token::authority = vault.key(),
        token::mint = vault_token_account.mint
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,
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
        seeds = [b"spot_market_vault".as_ref(), market_index.to_le_bytes().as_ref()],
        bump,
    )]
    pub drift_spot_market_vault: Box<Account<'info, TokenAccount>>,
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
    pub drift_user: AccountLoader<'info, User>,
    /// CHECK: checked in drift cpi
    pub drift_user_stats: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    pub drift_signer: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    pub drift_state: AccountInfo<'info>,
    pub drift_program: Program<'info, Drift>,
    pub token_program: Program<'info, Token>,
}

impl<'info> AddInsuranceFundStakeCPI for Context<'_, '_, '_, 'info, AddInsuranceFundStake<'info>> {
    fn drift_add_insurance_fund_stake(&self, market_index: u16, amount: u64) -> Result<()> {
        declare_vault_seeds!(self.accounts.vault, seeds);

        let cpi_accounts = DriftAddInsuranceFundStake {
            state: self.accounts.drift_state.clone(),
            spot_market: self.accounts.drift_spot_market.to_account_info().clone(),
            insurance_fund_stake: self.accounts.insurance_fund_stake.to_account_info().clone(),
            user_stats: self.accounts.drift_user_stats.clone(),
            authority: self.accounts.vault.to_account_info().clone(), // sign?
            spot_market_vault: self
                .accounts
                .drift_spot_market_vault
                .to_account_info()
                .clone(),
            insurance_fund_vault: self.accounts.insurance_fund_stake.to_account_info().clone(),
            drift_signer: self.accounts.drift_signer.to_account_info().clone(),
            user_token_account: self.accounts.vault_token_account.to_account_info().clone(),
            token_program: self.accounts.token_program.to_account_info().clone(),
        };

        let drift_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds)
            .with_remaining_accounts(self.remaining_accounts.into());
        drift::cpi::add_insurance_fund_stake(cpi_context, market_index, amount)?;

        Ok(())
    }
}

impl<'info> WithdrawCPI for Context<'_, '_, '_, 'info, AddInsuranceFundStake<'info>> {
    fn drift_withdraw(&self, amount: u64) -> Result<()> {
        implement_withdraw!(self, amount);
        Ok(())
    }
}
