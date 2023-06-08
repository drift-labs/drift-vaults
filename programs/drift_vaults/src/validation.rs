use crate::validate;
use anchor_lang::prelude::*;
use drift::error::{DriftResult, ErrorCode};

pub fn validate_equity((vault_equity, all_oracles_valid): (i128, bool)) -> DriftResult<i128> {
    validate!(all_oracles_valid, ErrorCode::DefaultError, "oracle invalid")?;
    validate!(
        vault_equity >= 0,
        ErrorCode::DefaultError,
        "vault equity negative"
    )?;

    Ok(vault_equity)
}
