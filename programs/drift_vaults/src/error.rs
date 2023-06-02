use anchor_lang::prelude::*;

pub type VaultResult<T = ()> = std::result::Result<T, ErrorCode>;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum ErrorCode {
    #[msg("Default")]
    Default,
    #[msg("Vault Math Error")]
    MathError,
    #[msg("InvalidVaultRebase")]
    InvalidVaultRebase,
    #[msg("InvalidVaultSharesDetected")]
    InvalidVaultSharesDetected,
    #[msg("TryingToRemoveLiquidityTooFast")]
    TryingToRemoveLiquidityTooFast,
    #[msg("InvalidIFUnstake")]
    InvalidIFUnstake,
    #[msg("InvalidIFUnstakeSize")]
    InvalidIFUnstakeSize,
    #[msg("InvalidVaultDepositorWithdrawCancel")]
    InvalidVaultDepositorWithdrawCancel,
    #[msg("InsufficientVaultShares")]
    InsufficientVaultShares,
    #[msg("InvalidVaultWithdrawSize")]
    InvalidVaultWithdrawSize,
    #[msg("InvalidVaultForNewDepositors")]
    InvalidVaultForNewDepositors,
}

#[macro_export]
macro_rules! math_error {
    () => {{
        || {
            let error_code = $crate::error::ErrorCode::MathError;
            msg!("Error {} thrown at {}:{}", error_code, file!(), line!());
            error_code
        }
    }};
}
