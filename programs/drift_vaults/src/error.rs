use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum ErrorCode {
    #[msg("Default")]
    Default,
    #[msg("Math Error")]
    MathError,
    #[msg("InvalidVaultRebase")]
    InvalidVaultRebase,
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
