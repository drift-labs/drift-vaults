use crate::error::ErrorCode;
use crate::Size;
use anchor_lang::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

use drift::math::constants::PERCENTAGE_PRECISION;

use crate::state::vault::Vault;
use crate::validate;
use static_assertions::const_assert_eq;

use crate::events::{VaultDepositorAction, VaultDepositorRecord};

use drift::math::insurance::{
    if_shares_to_vault_amount as depositor_shares_to_vault_amount,
    vault_amount_to_if_shares as vault_amount_to_depositor_shares,
};

use drift::math::casting::Cast;
use drift::math::safe_math::SafeMath;

#[account(zero_copy)]
#[derive(Default, Eq, PartialEq, Debug)]
#[repr(C)]
pub struct VaultDepositor {
    /// The vault deposited into
    pub vault: Pubkey,
    /// The vault depositor account's pubkey. It is a pda of vault and authority
    pub pubkey: Pubkey,
    /// The authority is the address w permission to deposit/withdraw
    pub authority: Pubkey,
    /// share of vault owned by this depositor. vault_shares / vault.total_shares is depositor's ownership of vault_equity
    vault_shares: u128,
    /// requested vault shares for withdraw
    pub last_withdraw_request_shares: u128,
    /// requested value (in vault spot_market_index) of shares for withdraw
    pub last_withdraw_request_value: u64,
    /// request ts of vault withdraw
    pub last_withdraw_request_ts: i64,
    /// creation ts of vault depositor
    pub last_valid_ts: i64,
    /// lifetime net deposits of vault depositor for the vault
    pub net_deposits: i64,
    /// the token amount of gains the vault depositor has paid performance fees on
    pub cumulative_profit_share_amount: i64,
    /// the exponent for vault_shares decimal places
    pub vault_shares_base: u32,
}

impl Size for VaultDepositor {
    const SIZE: usize = 176 + 8;
}

const_assert_eq!(
    VaultDepositor::SIZE,
    std::mem::size_of::<VaultDepositor>() + 8
);

impl VaultDepositor {
    pub fn new(vault: Pubkey, pubkey: Pubkey, authority: Pubkey, now: i64) -> Self {
        VaultDepositor {
            vault,
            pubkey,
            authority,
            vault_shares: 0,
            vault_shares_base: 0,
            last_withdraw_request_value: 0,
            last_withdraw_request_shares: 0,
            last_withdraw_request_ts: 0,
            last_valid_ts: now,
            net_deposits: 0,
            cumulative_profit_share_amount: 0,
        }
    }

    fn validate_base(&self, vault: &Vault) -> Result<()> {
        validate!(
            self.vault_shares_base == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor bases mismatch. user base: {} vault base {}",
            self.vault_shares_base,
            vault.shares_base
        )?;

        Ok(())
    }

    pub fn checked_vault_shares(&self, vault: &Vault) -> Result<u128> {
        self.validate_base(vault)?;
        Ok(self.vault_shares)
    }

    pub fn unchecked_vault_shares(&self) -> u128 {
        self.vault_shares
    }

    pub fn increase_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = self.vault_shares.safe_add(delta)?;
        Ok(())
    }

    pub fn decrease_vault_shares(&mut self, delta: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = self.vault_shares.safe_sub(delta)?;
        Ok(())
    }

    pub fn update_vault_shares(&mut self, new_shares: u128, vault: &Vault) -> Result<()> {
        self.validate_base(vault)?;
        self.vault_shares = new_shares;

        Ok(())
    }

    pub fn apply_rebase(
        self: &mut VaultDepositor,
        vault: &mut Vault,
        vault_equity: u64,
    ) -> Result<()> {
        vault.apply_rebase(vault_equity)?;

        if vault.shares_base != self.vault_shares_base {
            validate!(
                vault.shares_base > self.vault_shares_base,
                ErrorCode::InvalidVaultRebase,
                "Rebase expo out of bounds"
            )?;

            let expo_diff = (vault.shares_base - self.vault_shares_base).cast::<u32>()?;

            let rebase_divisor = 10_u128.pow(expo_diff);

            msg!(
                "rebasing vault depositor: base: {} -> {} ",
                self.vault_shares_base,
                vault.shares_base,
            );

            self.vault_shares_base = vault.shares_base;

            let old_vault_shares = self.unchecked_vault_shares();
            let new_vault_shares = old_vault_shares.safe_div(rebase_divisor)?;

            msg!("rebasing vault depositor: shares -> {} ", new_vault_shares);

            self.update_vault_shares(new_vault_shares, vault)?;

            self.last_withdraw_request_shares =
                self.last_withdraw_request_shares.safe_div(rebase_divisor)?;
        }

        validate!(
            self.vault_shares_base == vault.shares_base,
            ErrorCode::InvalidVaultRebase,
            "vault depositor shares_base != vault shares_base"
        )?;

        Ok(())
    }

    pub fn calculate_vault_shares_lost(
        self: &VaultDepositor,
        vault: &Vault,
        vault_equity: u64,
    ) -> Result<u128> {
        let n_shares = self.last_withdraw_request_shares;

        let amount = depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?;

        let vault_shares_lost = if amount > self.last_withdraw_request_value {
            let new_n_shares = vault_amount_to_depositor_shares(
                self.last_withdraw_request_value,
                vault.total_shares.safe_sub(n_shares)?,
                vault_equity.safe_sub(self.last_withdraw_request_value)?,
            )?;

            validate!(
                new_n_shares <= n_shares,
                ErrorCode::InvalidVaultSharesDetected,
                "Issue calculating delta if_shares after canceling request {} < {}",
                new_n_shares,
                n_shares
            )?;

            n_shares.safe_sub(new_n_shares)?
        } else {
            0
        };

        Ok(vault_shares_lost)
    }

    pub fn calculate_profit_share_and_update(
        self: &mut VaultDepositor,
        withdraw_amount: u64,
        total_amount: u64,
        vault: &Vault,
    ) -> Result<u128> {
        let profit = total_amount.cast::<i64>()?.safe_sub(
            self.net_deposits
                .safe_add(self.cumulative_profit_share_amount)?,
        )?;
        if profit > 0 {
            let profit_u128 = profit.cast::<u128>()?;
            let frac_profit_withdrawn = profit_u128
                .safe_mul(withdraw_amount.cast()?)?
                .safe_div(total_amount.cast()?)?;

            let profit_share_amount = frac_profit_withdrawn
                .safe_mul(vault.profit_share.cast()?)?
                .safe_div(PERCENTAGE_PRECISION)?;

            self.cumulative_profit_share_amount = self
                .cumulative_profit_share_amount
                .safe_add(frac_profit_withdrawn.cast()?)?;

            return Ok(profit_share_amount);
        }

        Ok(0)
    }

    pub fn reset_withdraw_request(self: &mut VaultDepositor, now: i64) -> Result<()> {
        // reset vault_depositor withdraw request info
        self.last_withdraw_request_shares = 0;
        self.last_withdraw_request_value = 0;
        self.last_withdraw_request_ts = now;
        Ok(())
    }

    pub fn deposit(
        self: &mut VaultDepositor,
        amount: u64,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        validate!(
            !(vault_equity == 0 && vault.total_shares != 0),
            ErrorCode::InvalidVaultForNewDepositors,
            "Vault balance should be non-zero for new depositors to enter"
        )?;

        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let n_shares = vault_amount_to_depositor_shares(amount, vault.total_shares, vault_equity)?;

        // reset cost basis if no shares
        self.net_deposits = self.net_deposits.safe_add(amount.cast()?)?;
        self.increase_vault_shares(n_shares, vault)?;

        vault.total_shares = vault.total_shares.safe_add(n_shares)?;

        vault.user_shares = vault.user_shares.safe_add(n_shares)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;
        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Deposit,
            amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share: 0,
            management_fee: 0,
        });

        Ok(())
    }

    pub fn request_withdraw(
        self: &mut VaultDepositor,
        withdraw_amount: u128,
        withdraw_unit: WithdrawUnit,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        self.apply_rebase(vault, vault_equity)?;

        let (withdraw_value, n_shares) = match withdraw_unit {
            WithdrawUnit::Token => {
                let withdraw_value: u64 = withdraw_amount.cast()?;
                let n_shares: u128 = vault_amount_to_depositor_shares(
                    withdraw_value,
                    vault.total_shares,
                    vault_equity,
                )?;
                (withdraw_value, n_shares)
            }
            WithdrawUnit::Shares => {
                let n_shares: u128 = withdraw_amount;
                let withdraw_value: u64 =
                    depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?
                        .min(vault_equity);
                (withdraw_value, n_shares)
            }
        };

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested n_shares = 0"
        )?;
        validate!(
            self.last_withdraw_request_shares == 0,
            ErrorCode::VaultWithdrawRequestInProgress,
            "Vault withdraw request is already in progress"
        )?;

        self.last_withdraw_request_shares = n_shares;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        validate!(
            self.last_withdraw_request_shares <= self.checked_vault_shares(vault)?,
            ErrorCode::InvalidVaultWithdrawSize,
            "last_withdraw_request_shares exceeds vault_shares {} > {}",
            self.last_withdraw_request_shares,
            self.checked_vault_shares(vault)?
        )?;

        self.last_withdraw_request_value = withdraw_value;

        vault.total_withdraw_requested = vault.total_withdraw_requested.safe_add(withdraw_value)?;

        validate!(
            self.last_withdraw_request_value == 0
                || self.last_withdraw_request_value <= vault_equity,
            ErrorCode::InvalidVaultWithdrawSize,
            "Requested withdraw value {} is not equal or below vault_equity {}",
            self.last_withdraw_request_value,
            vault_equity
        )?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::WithdrawRequest,
            amount: self.last_withdraw_request_value,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share: 0,
            management_fee: 0,
        });

        self.last_withdraw_request_ts = now;

        Ok(())
    }

    pub fn cancel_withdraw_request(
        self: &mut VaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<()> {
        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let vault_shares_lost = self.calculate_vault_shares_lost(vault, vault_equity)?;
        self.decrease_vault_shares(vault_shares_lost, vault)?;

        vault.total_shares = vault.total_shares.safe_sub(vault_shares_lost)?;

        vault.user_shares = vault.user_shares.safe_sub(vault_shares_lost)?;

        vault.total_withdraw_requested = vault
            .total_withdraw_requested
            .safe_sub(self.last_withdraw_request_value)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::CancelWithdrawRequest,
            amount: 0,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share: 0,
            management_fee: 0,
        });

        self.reset_withdraw_request(now)?;

        Ok(())
    }

    pub fn withdraw(
        self: &mut VaultDepositor,
        vault_equity: u64,
        vault: &mut Vault,
        now: i64,
    ) -> Result<u64> {
        let time_since_withdraw_request = now.safe_sub(self.last_withdraw_request_ts)?;

        validate!(
            time_since_withdraw_request >= vault.redeem_period,
            ErrorCode::CannotWithdrawBeforeRedeemPeriodEnd
        )?;

        self.apply_rebase(vault, vault_equity)?;

        let vault_shares_before: u128 = self.checked_vault_shares(vault)?;
        let total_vault_shares_before = vault.total_shares;
        let user_vault_shares_before = vault.user_shares;

        let n_shares = self.last_withdraw_request_shares;

        validate!(
            n_shares > 0,
            ErrorCode::InvalidVaultWithdraw,
            "Must submit withdraw request and wait the redeem_period ({} seconds)",
            vault.redeem_period
        )?;

        validate!(
            vault_shares_before >= n_shares,
            ErrorCode::InsufficientVaultShares
        )?;

        let total_amount =
            depositor_shares_to_vault_amount(self.vault_shares, vault.total_shares, vault_equity)?;

        let amount = depositor_shares_to_vault_amount(n_shares, vault.total_shares, vault_equity)?;

        let withdraw_amount = amount.min(self.last_withdraw_request_value);
        msg!(
            "amount={}, last_withdraw_request_value={}",
            amount,
            self.last_withdraw_request_value
        );

        let profit_share: u64 = self
            .calculate_profit_share_and_update(withdraw_amount, total_amount, vault)?
            .cast()?;

        let profit_share_shares: u128 =
            vault_amount_to_depositor_shares(profit_share, vault.total_shares, vault_equity)?;

        self.decrease_vault_shares(n_shares, vault)?;

        self.net_deposits = self.net_deposits.safe_sub(withdraw_amount.cast()?)?;

        vault.total_shares = vault
            .total_shares
            .safe_sub(n_shares.safe_sub(profit_share_shares)?)?;

        vault.user_shares = vault.user_shares.safe_sub(n_shares)?;

        self.reset_withdraw_request(now)?;

        let vault_shares_after = self.checked_vault_shares(vault)?;

        emit!(VaultDepositorRecord {
            ts: now,
            vault: vault.pubkey,
            depositor_authority: self.authority,
            action: VaultDepositorAction::Withdraw,
            amount: withdraw_amount,
            spot_market_index: vault.spot_market_index,
            vault_equity_before: vault_equity,
            vault_shares_before,
            user_vault_shares_before,
            total_vault_shares_before,
            vault_shares_after,
            total_vault_shares_after: vault.total_shares,
            user_vault_shares_after: vault.user_shares,
            profit_share,
            management_fee: 0,
        });

        let user_withdraw_amount = withdraw_amount.safe_sub(profit_share.cast()?)?;
        vault.total_withdraw_requested =
            vault.total_withdraw_requested.safe_sub(withdraw_amount)?;

        Ok(user_withdraw_amount)
    }
}

#[derive(Debug, Clone, Copy, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum WithdrawUnit {
    Shares,
    Token,
}

#[cfg(test)]
mod tests {
    use crate::{Vault, VaultDepositor, WithdrawUnit};
    use anchor_lang::prelude::Pubkey;
    use drift::math::casting::Cast;
    use drift::math::constants::{QUOTE_PRECISION, QUOTE_PRECISION_U64};
    use drift::math::insurance::if_shares_to_vault_amount;

    #[test]
    fn base_init() {
        let now = 1337;
        let vd = VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.last_valid_ts, now);
    }

    #[test]
    fn test_deposit_withdraw() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();

        let vault_equity: u64 = 200 * QUOTE_PRECISION_U64;

        vd.request_withdraw(
            amount.cast().unwrap(),
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();

        let withdraw_amount = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(withdraw_amount, amount);
    }

    #[test]
    fn test_deposit_paritial_withdraw_profit_share() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);

        vault.profit_share = 100000; // 10% profit share
        vault_equity = 400 * QUOTE_PRECISION_U64; // up 100%

        // withdraw principal
        vd.request_withdraw(
            amount.cast().unwrap(),
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);

        assert_eq!(vd.last_withdraw_request_shares, 50000000);
        assert_eq!(vd.last_withdraw_request_value, 100000000);
        assert_eq!(vd.last_withdraw_request_ts, now + 20);

        let withdraw_amount = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 50000000);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vault.user_shares, 50000000);
        assert_eq!(vault.total_shares, 152500000);
        assert_eq!(withdraw_amount, amount - amount / 20);

        vault_equity -= withdraw_amount;

        let admin_owned_shares = vault.total_shares.checked_sub(vault.user_shares).unwrap();
        let admin_owned_amount =
            if_shares_to_vault_amount(admin_owned_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(admin_owned_amount, 205000000); // $205
    }

    #[test]
    fn test_deposit_full_withdraw_profit_share() {
        let now = 1000;
        let vault = &mut Vault::default();

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);

        vault.profit_share = 100000; // 10% profit share
        vault_equity = 400 * QUOTE_PRECISION_U64; // up 100%

        // withdraw all
        vd.request_withdraw(
            200 * QUOTE_PRECISION,
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 100000000);

        assert_eq!(vd.last_withdraw_request_shares, 100000000);
        assert_eq!(vd.last_withdraw_request_value, 200000000);
        assert_eq!(vd.last_withdraw_request_ts, now + 20);

        let withdraw_amount = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), 0);
        assert_eq!(vd.vault_shares_base, 0);
        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 105000000);
        assert_eq!(withdraw_amount, amount * 2 - amount * 2 / 20);
        assert_eq!(vd.cumulative_profit_share_amount, 100000000); // $100

        vault_equity -= withdraw_amount;

        let admin_owned_shares = vault.total_shares.checked_sub(vault.user_shares).unwrap();
        let admin_owned_amount =
            if_shares_to_vault_amount(admin_owned_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(admin_owned_amount, 210000000); // $210
    }
}
