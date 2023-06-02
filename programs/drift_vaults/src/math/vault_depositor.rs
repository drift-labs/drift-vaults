
pub fn get_proportion_u128(value: u128, numerator: u128, denominator: u128) -> DriftResult<u128> {
    // we use u128::max.sqrt() here
    let large_constant = u64::MAX.cast::<u128>()?;

    let proportional_value = if numerator == denominator {
        value
    } else if value >= large_constant || numerator >= large_constant {
        let value = U192::from(value)
            .safe_mul(U192::from(numerator))?
            .safe_div(U192::from(denominator))?;

        value.cast::<u128>()?
    } else if numerator > denominator / 2 && denominator > numerator {
        // get values to ensure a ceiling division
        let (std_value, r) = standardize_value_with_remainder_i128(
            value
                .safe_mul(denominator.safe_sub(numerator)?)?
                .cast::<i128>()?,
            denominator,
        )?;

        // perform ceiling division by subtracting one if there is a remainder
        value
            .safe_sub(std_value.cast::<u128>()?.safe_div(denominator)?)?
            .safe_sub(r.signum().cast::<u128>()?)?
    } else {
        value.safe_mul(numerator)?.safe_div(denominator)?
    };

    Ok(proportional_value)
}

pub fn log10_iter(n: u128) -> u128 {
    let mut result = 0;
    let mut n_copy = n;

    while n_copy >= 10 {
        result += 1;
        n_copy /= 10;
    }

    result
}







pub fn vault_amount_to_vault_shares(
    amount: u64,
    total_shares: u128,
    vault_balance: u64,
) -> Result<u128> {
    // relative to the entire pool + total amount minted
    let n_shares = if vault_balance > 0 {
        // assumes total_shares != 0 (in most cases) for nice result for user

        get_proportion_u128(
            amount.cast::<u128>()?,
            total_shares,
            vault_balance.cast::<u128>()?,
        )?
    } else {
        // must be case that total_shares == 0 for nice result for user
        validate!(
            total_shares == 0,
            ErrorCode::InvalidVaultSharesDetected,
            "assumes total_shares == 0",
        )?;

        amount.cast::<u128>()?
    };

    Ok(n_shares)
}

pub fn vault_shares_to_vault_amount(
    n_shares: u128,
    total_shares: u128,
    vault_balance: u64,
) -> DriftResult<u64> {
    validate!(
        n_shares <= total_shares,
        ErrorCode::InvalidVaultSharesDetected,
        "n_shares({}) > total_shares({})",
        n_shares,
        total_shares
    )?;

    let amount = if total_shares > 0 {
        get_proportion_u128(
            vault_balance as u128,
            n_shares,
            total_shares as u128,
        )?
        .cast::<u64>()?
    } else {
        0
    };

    Ok(amount)
}

pub fn calculate_rebase_info(
    total_shares: u128,
    vault_balance: u64,
) -> DriftResult<(u32, u128)> {
    let rebase_divisor_full = total_shares
        .safe_div(10)?
        .safe_div(vault_balance.cast::<u128>()?)?;

    let expo_diff = log10_iter(rebase_divisor_full).cast::<u32>()?;
    let rebase_divisor = 10_u128.pow(expo_diff);

    Ok((expo_diff, rebase_divisor))
}

pub fn calculate_vault_shares_lost(
    vault_depositor: &VaultDepositor,
    vault: &Vault,
    vault_balance: u64,
) -> Result<u128> {
    let n_shares = vault_depositor.last_withdraw_request_shares;

    let amount = vault_shares_to_vault_amount(
        n_shares,
        vault.total_shares,
        vault_balance,
    )?;

    let vault_shares_lost = if amount > vault_depositor.last_withdraw_request_value {
        let new_n_shares = vault_amount_to_vault_shares(
            vault_depositor.last_withdraw_request_value,
            vault.total_shares - n_shares,
            vault_balance - vault_depositor.last_withdraw_request_value,
        )?;

        validate!(
            new_n_shares <= n_shares,
            ErrorCode::InvalidVaultSharesDetected,
            "Issue calculating delta vault_shares after canceling request {} < {}",
            new_n_shares,
            n_shares
        )?;

        n_shares.safe_sub(new_n_shares)?
    } else {
        0
    };

    Ok(vault_shares_lost)
}
