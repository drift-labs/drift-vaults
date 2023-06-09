use crate::Size;

use anchor_lang::prelude::*;
use drift::error::{DriftResult, ErrorCode};
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
    /// The spot market index the vault deposits into/withdraws from
    pub spot_market_index: u16,
    /// The bump for the vault pda
    pub bump: u8,
    pub padding: [u8; 1],
    /// the period (in seconds) that a vault depositor must wait after requesting a withdraw to complete withdraw
    pub redeem_period: i64,
    /// the base 10 exponent of the shares (given massive share inflation can occur at near zero vault equity)  
    pub shares_base: u32,
    /// the sum of all shares held by the users (vault depositors)
    pub user_shares: u128,
    /// the sum of all shares (including vault authority)
    pub total_shares: u128,
    /// sum of outstanding withdraw request amount (in tokens) of all vault depositors
    pub total_withdraw_requested: u64,
    /// percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION
    pub profit_share: u32,
    /// vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION
    pub hurdle_rate: u32, // todo: not implemented yet
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 264 + 8;
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
    ) -> DriftResult<u64> {
        let (vault_equity, all_oracles_valid) =
            calculate_user_equity(user, perp_market_map, spot_market_map, oracle_map)?;

        validate!(all_oracles_valid, ErrorCode::DefaultError, "oracle invalid")?;
        validate!(
            vault_equity >= 0,
            ErrorCode::DefaultError,
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
    }
}
