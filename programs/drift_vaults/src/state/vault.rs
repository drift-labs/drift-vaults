use crate::{Size, VaultDepositor};

use crate::constants::TIME_FOR_LIQUIDATION;
use crate::error::{ErrorCode, VaultResult};
use anchor_lang::prelude::*;
use drift::math::casting::Cast;
use drift::math::insurance::calculate_rebase_info;
use drift::math::margin::calculate_user_equity;
use drift::math::safe_math::SafeMath;
use drift::state::oracle_map::OracleMap;
use drift::state::perp_market_map::PerpMarketMap;
use drift::state::spot_market_map::SpotMarketMap;
use drift::state::user::User;
use drift::validate;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct Vault {
    /// The name of the vault. Vault pubkey is derived from this name.
    pub name: [u8; 32],
    /// The vault's pubkey. It is a pda of name and also used as the authority for drift user
    pub pubkey: Pubkey,
    /// The authority of the vault who has ability to update vault params
    pub authority: Pubkey,
    /// The vaults token account. Used to receive tokens between deposits and withdrawals
    pub token_account: Pubkey,
    /// The drift user stats account for the vault
    pub user_stats: Pubkey,
    /// The drift user account for the vault
    pub user: Pubkey,
    /// The vaults designated delegate for drift user account
    /// Can differ from actual user delegate if vault is in liquidation
    pub delegate: Pubkey,
    /// The delegate handling liquidation for depositor
    pub liquidation_delegate: Pubkey,
    /// the sum of all shares held by the users (vault depositors)
    pub user_shares: u128,
    /// the sum of all shares (including vault authority)
    pub total_shares: u128,
    /// When the liquidation start
    pub liquidation_start_ts: i64,
    /// the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw
    pub redeem_period: i64,
    /// the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)  
    pub shares_base: u32,
    /// percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION
    pub profit_share: u32,
    /// vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION
    pub hurdle_rate: u32, // todo: not implemented yet
    /// The spot market index the vault deposits into/withdraws from
    pub spot_market_index: u16,
    /// The bump for the vault pda
    pub bump: u8,
    pub padding: [u8; 1],
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 320 + 8;
}

const_assert_eq!(Vault::SIZE, std::mem::size_of::<Vault>() + 8);

impl Vault {
    pub fn apply_rebase(&mut self, vault_equity: u64) -> Result<()> {
        if vault_equity != 0 && vault_equity.cast::<u128>()? < self.total_shares {
            let (expo_diff, rebase_divisor) =
                calculate_rebase_info(self.total_shares, vault_equity)?;

            self.total_shares = self.total_shares.safe_div(rebase_divisor)?;
            self.user_shares = self.user_shares.safe_div(rebase_divisor)?;
            self.shares_base = self.shares_base.safe_add(expo_diff)?;

            msg!("rebasing vault: expo_diff={}", expo_diff);
        }

        if vault_equity != 0 && self.total_shares == 0 {
            self.total_shares = vault_equity.cast::<u128>()?;
        }

        Ok(())
    }

    /// Returns the equity value of the vault, in the vault's spot market token min precision
    pub fn calculate_equity(
        &self,
        user: &User,
        perp_market_map: &PerpMarketMap,
        spot_market_map: &SpotMarketMap,
        oracle_map: &mut OracleMap,
    ) -> VaultResult<u64> {
        let (vault_equity, all_oracles_valid) =
            calculate_user_equity(user, perp_market_map, spot_market_map, oracle_map)?;

        validate!(
            all_oracles_valid,
            ErrorCode::InvalidEquityValue,
            "oracle invalid"
        )?;
        validate!(
            vault_equity >= 0,
            ErrorCode::InvalidEquityValue,
            "vault equity negative"
        )?;

        let spot_market = spot_market_map.get_ref(&self.spot_market_index)?;
        let spot_market_precision = spot_market.get_precision().cast::<i128>()?;
        let oracle_price = oracle_map
            .get_price_data(&spot_market.oracle)?
            .price
            .cast::<i128>()?;

        vault_equity
            .safe_mul(spot_market_precision)?
            .safe_div(oracle_price)?
            .cast()
            .map_err(|e| e.into())
    }

    pub fn check_delegate_available_for_liquidation(
        &self,
        vault_depositor: &VaultDepositor,
        now: i64,
    ) -> VaultResult {
        validate!(
            self.liquidation_delegate != vault_depositor.authority,
            ErrorCode::DelegateNotAvailableForLiquidation,
            "liquidation delegate is already vault depositor"
        )?;

        validate!(
            now.saturating_sub(self.liquidation_start_ts) > TIME_FOR_LIQUIDATION,
            ErrorCode::DelegateNotAvailableForLiquidation,
            "vault is already in liquidation"
        )?;

        Ok(())
    }

    pub fn in_liquidation(&self) -> bool {
        self.liquidation_delegate != Pubkey::default()
    }

    pub fn check_can_exit_liquidation(&self, now: i64) -> VaultResult {
        validate!(
            now.saturating_sub(self.liquidation_start_ts) > TIME_FOR_LIQUIDATION,
            ErrorCode::VaultInLiquidation,
            "vault is in liquidation"
        )?;

        Ok(())
    }

    pub fn set_liquidation_delegate(&mut self, liquidation_delegate: Pubkey, now: i64) {
        self.liquidation_delegate = liquidation_delegate;
        self.liquidation_start_ts = now;
    }

    pub fn reset_liquidation_delegate(&mut self) {
        self.liquidation_delegate = Pubkey::default();
        self.liquidation_start_ts = 0;
    }
}
