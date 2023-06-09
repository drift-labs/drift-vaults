use crate::events::{VaultDepositorAction, VaultDepositorRecord};
use crate::Size;
use crate::WithdrawUnit;
use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};

use crate::validate;
use anchor_lang::prelude::*;
// use drift::error::{DriftResult};
use crate::error::ErrorCode;
use drift::math::casting::Cast;
use drift::math::insurance::calculate_rebase_info;
use drift::math::margin::calculate_user_equity;
use drift::math::safe_math::SafeMath;
use drift::state::oracle_map::OracleMap;
use drift::state::perp_market_map::PerpMarketMap;
use drift::state::spot_market_map::SpotMarketMap;
use drift::state::user::User;
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
    /// max token capacity, once hit/passed vault will reject new deposits
    pub max_tokens: u64,
    /// percentage of gains for vault admin upon depositor's realize/withdraw: PERCENTAGE_PRECISION
    pub profit_share: u32,
    /// vault admin only collect incentive fees during periods when returns are higher than this amount: PERCENTAGE_PRECISION
    pub hurdle_rate: u32, // todo: not implemented yet
    /// annualized vault admin management fee
    pub management_fee: u32,
}

impl Vault {
    pub fn get_vault_signer_seeds<'a>(name: &'a [u8], bump: &'a u8) -> [&'a [u8]; 3] {
        [b"vault".as_ref(), name, bytemuck::bytes_of(bump)]
    }
}

impl Size for Vault {
    const SIZE: usize = 272 + 8;
}

const_assert_eq!(Vault::SIZE, std::mem::size_of::<Vault>() + 8);

use std::time::SystemTime;

fn convert_unix_timestamp(timestamp: u64) -> Option<String> {
    let unix_epoch = SystemTime::UNIX_EPOCH;
    let time = unix_epoch + std::time::Duration::from_secs(timestamp);

    match time.duration_since(unix_epoch) {
        Ok(duration) => {
            let local_time = SystemTime::now()
                .duration_since(unix_epoch)
                .expect("Failed to get current time");
            if duration > local_time {
                return None;
            }

            // let offset = local_time - duration;
            let converted_time = unix_epoch + duration;

            let formatted_date = converted_time
                .duration_since(unix_epoch)
                .expect("Failed to get converted time")
                .as_secs();

            Some(
                chrono::NaiveDateTime::from_timestamp_opt(formatted_date as i64, 0)
                    .unwrap()
                    .format("%Y-%m-%d %H:%M:%S")
                    .to_string(),
            )
        }
        Err(_) => None,
    }
}

impl Vault {
    pub fn get_date(self) -> Result<()> {
        let timestamp = 1622977144; // Replace with your desired Unix timestamp

        match convert_unix_timestamp(timestamp) {
            Some(date) => msg!("Converted date: {}", date),
            None => msg!("Invalid Unix timestamp"),
        }

        Ok(())
    }

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

    pub fn ma_deposit(&mut self, amount: u64, vault_equity: u64, now: i64) -> Result<()> {
        let user_vault_shares_before = self.user_shares;
        let total_vault_shares_before = self.total_shares;
        let vault_shares_before = self.total_shares.safe_sub(self.user_shares)?;

        let n_shares =
            vault_amount_to_depositor_shares(amount, total_vault_shares_before, vault_equity)?;

        self.total_shares = self.total_shares.safe_add(n_shares)?;
        let vault_shares_after = self.total_shares.safe_sub(self.user_shares)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Deposit,
            amount: 0,
            spot_market_index: self.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: self.total_shares,
            user_vault_shares_after: self.user_shares,
            profit_share: 0,
            management_fee: 0,
        });

        Ok(())
    }

    pub fn admin_withdraw(
        &mut self,
        withdraw_amount: u128,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        now: i64,
    ) -> Result<u64> {
        let (n_tokens, n_shares) = match withdraw_unit {
            WithdrawUnit::Token => {
                let n_tokens: u64 = withdraw_amount.cast()?;
                let n_shares: u128 =
                    vault_amount_to_depositor_shares(n_tokens, self.total_shares, vault_equity)?;
                (n_tokens, n_shares)
            }
            WithdrawUnit::Shares => {
                let n_shares: u128 = withdraw_amount;
                let n_tokens: u64 =
                    depositor_shares_to_vault_amount(n_shares, self.total_shares, vault_equity)?
                        .min(vault_equity);
                (n_tokens, n_shares)
            }
        };

        let user_vault_shares_before = self.user_shares;
        let total_vault_shares_before = self.total_shares;
        let vault_shares_before = self.total_shares.safe_sub(self.user_shares)?;

        validate!(
            vault_shares_before >= n_shares,
            ErrorCode::InvalidVaultWithdrawSize,
            "vault_shares_before={} < n_shares={}",
            vault_shares_before,
            n_shares
        )?;

        self.total_shares = self.total_shares.safe_sub(n_shares)?;
        let vault_shares_after = self.total_shares.safe_sub(self.user_shares)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: self.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Withdraw,
            amount: 0,
            spot_market_index: self.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: self.total_shares,
            user_vault_shares_after: self.user_shares,
            profit_share: 0,
            management_fee: 0,
        });

        Ok(n_tokens)
    }

    /// Returns the equity value of the vault, in the vault's spot market token min precision
    pub fn calculate_equity(
        &self,
        user: &User,
        perp_market_map: &PerpMarketMap,
        spot_market_map: &SpotMarketMap,
        oracle_map: &mut OracleMap,
    ) -> Result<u64> {
        let (vault_equity, all_oracles_valid) =
            calculate_user_equity(user, perp_market_map, spot_market_map, oracle_map)?;

        validate!(all_oracles_valid, ErrorCode::Default, "oracle invalid")?;
        validate!(
            vault_equity >= 0,
            ErrorCode::Default,
            "vault equity negative"
        )?;

        let spot_market = spot_market_map.get_ref(&self.spot_market_index)?;
        let spot_market_precision = spot_market.get_precision().cast::<i128>()?;
        let oracle_price = oracle_map
            .get_price_data(&spot_market.oracle)?
            .price
            .cast::<i128>()?;

        Ok(vault_equity
            .safe_mul(spot_market_precision)?
            .safe_div(oracle_price)?
            .cast::<u64>()?)
    }
}
