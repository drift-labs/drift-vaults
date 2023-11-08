use crate::error::{ErrorCode, VaultResult};
use crate::validate;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::msg;
use borsh::{BorshDeserialize, BorshSerialize};
use drift::math::casting::Cast;
use drift::math::safe_math::SafeMath;

use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};

#[derive(Debug, Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum WithdrawUnit {
    Shares,
    Token,
    SharesPercent,
}

const MAX_WITHDRAW_PERCENT: u128 = 1_000_000;
impl WithdrawUnit {
    pub fn get_withdraw_value_and_shares(
        &self,
        withdraw_amount: u64,
        vault_equity: u64,
        shares: u128,
        total_shares: u128,
    ) -> VaultResult<(u64, u128)> {
        match self {
            WithdrawUnit::Token => {
                let withdraw_value = withdraw_amount;
                let n_shares: u128 =
                    vault_amount_to_depositor_shares(withdraw_value, total_shares, vault_equity)?;
                Ok((withdraw_value, n_shares))
            }
            WithdrawUnit::Shares => {
                let n_shares = withdraw_amount.cast::<u128>()?;
                let withdraw_value =
                    depositor_shares_to_vault_amount(n_shares, total_shares, vault_equity)?
                        .min(vault_equity);
                Ok((withdraw_value, n_shares))
            }
            WithdrawUnit::SharesPercent => {
                let n_shares =
                    WithdrawUnit::get_shares_from_percent(withdraw_amount.cast()?, shares)?;
                let withdraw_value: u64 =
                    depositor_shares_to_vault_amount(n_shares, total_shares, vault_equity)?
                        .min(vault_equity);
                Ok((withdraw_value, n_shares))
            }
        }
    }

    /// returns the amount and shares transfered as a result of transfering `amount` and changing
    /// `total_shares` to `new_total_shares`
    pub fn get_transfer_value_with_new_total(
        &self,
        amount: u64,
        vault_equity: u64,
        user_shares: u128,
        total_shares: u128,
    ) -> VaultResult<(u64, u128)> {
        match self {
            WithdrawUnit::Token => {
                let transfer_value = amount;
                let new_total_shares = user_shares
                    .safe_mul(vault_equity.cast::<u128>()?)?
                    .safe_div(vault_equity.safe_sub(amount)?.cast::<u128>()?)?;

                Ok((transfer_value, new_total_shares))
            }
            WithdrawUnit::Shares => {
                let transfer_value = depositor_shares_to_vault_amount(
                    amount.cast::<u128>()?,
                    total_shares,
                    vault_equity,
                )?;

                let new_total_shares = user_shares
                    .safe_mul(vault_equity.cast::<u128>()?)?
                    .safe_div(vault_equity.safe_sub(transfer_value)?.cast::<u128>()?)?;
                Ok((transfer_value, new_total_shares))
            }
            WithdrawUnit::SharesPercent => {
                let manager_shares = total_shares.safe_sub(user_shares)?;
                let transfer_shares =
                    WithdrawUnit::get_shares_from_percent(amount.cast()?, manager_shares)?;
                let transfer_value = depositor_shares_to_vault_amount(
                    transfer_shares.cast::<u128>()?,
                    total_shares,
                    vault_equity,
                )?;
                let new_total_shares = user_shares
                    .safe_mul(vault_equity.cast::<u128>()?)?
                    .safe_div(vault_equity.safe_sub(transfer_value)?.cast::<u128>()?)?;
                Ok((transfer_value, new_total_shares))
            }
        }
    }

    fn get_shares_from_percent(percent: u128, shares: u128) -> VaultResult<u128> {
        validate!(
            percent <= MAX_WITHDRAW_PERCENT,
            ErrorCode::SharesPercentTooLarge
        )?;
        let shares = shares.safe_mul(percent)?.safe_div(MAX_WITHDRAW_PERCENT)?;
        Ok(shares)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_value_and_shares_with_new_total() {
        // want shares to transfer 100 tokens
        let withdraw_unit = WithdrawUnit::Token;
        let result = withdraw_unit.get_transfer_value_with_new_total(
            50_000_000, // 50 tokens
            1000_000_000,
            90_000_000, // manager shares = 100 - 90 = 10
            100_000_000,
        );
        assert!(result.is_ok());
        let (value, new_total_shares) = result.unwrap();
        assert_eq!(value, 50_000_000);
        // before: manager owns (100-90)/100 * 1000 = 100
        // after: manager owns (94.736842-90)/94.736842 * 1000 = 49.999998
        assert_eq!(new_total_shares, 94736842);

        // want shares to transfer 5 shares
        let withdraw_unit = WithdrawUnit::Shares;
        let result = withdraw_unit.get_transfer_value_with_new_total(
            5_000_000, // 5 tokens
            1000_000_000,
            90_000_000, // manager shares = 100 - 90 = 10
            100_000_000,
        );
        assert!(result.is_ok());
        let (value, new_total_shares) = result.unwrap();
        assert_eq!(value, 50_000_000);
        // before: manager owns (100-90)/100 * 1000 = 100
        // after: manager owns (94.736842-90)/94.736842 * 1000 = 49.999998
        assert_eq!(new_total_shares, 94736842);

        // want shares to transfer 50% of shares
        let withdraw_unit = WithdrawUnit::SharesPercent;
        let result = withdraw_unit.get_transfer_value_with_new_total(
            500_000, // 0.50
            1000_000_000,
            90_000_000, // manager shares = 100 - 90 = 10
            100_000_000,
        );
        assert!(result.is_ok());
        let (value, new_total_shares) = result.unwrap();
        assert_eq!(value, 50_000_000);
        // before: manager owns (100-90)/100 * 1000 = 100
        // after: manager owns (94.736842-90)/94.736842 * 1000 = 49.999998
        assert_eq!(new_total_shares, 94736842);
    }
}
