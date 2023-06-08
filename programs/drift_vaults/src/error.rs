use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum ErrorCode {
    #[msg("Default")]
    Default,
    #[msg("InvalidVaultRebase")]
    InvalidVaultRebase,
    #[msg("InvalidVaultSharesDetected")]
    InvalidVaultSharesDetected,
    #[msg("CannotWithdrawBeforeRedeemPeriodEnd")]
    CannotWithdrawBeforeRedeemPeriodEnd,
    #[msg("InvalidVaultWithdraw")]
    InvalidVaultWithdraw,
    #[msg("InsufficientVaultShares")]
    InsufficientVaultShares,
    #[msg("InvalidVaultWithdrawSize")]
    InvalidVaultWithdrawSize,
    #[msg("InvalidVaultForNewDepositors")]
    InvalidVaultForNewDepositors,
    #[msg("VaultWithdrawRequestInProgress")]
    VaultWithdrawRequestInProgress,
}
