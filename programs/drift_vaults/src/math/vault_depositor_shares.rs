pub fn add_vault_depositor(
    amount: u64,
    vault_amount: u64,
    vault_depositor: &mut VaultDepositor,
    vault: &mut Vault,
    now: i64,
) -> DriftResult {
    validate!(
        !(vault_amount == 0 && vault.total_shares != 0),
        ErrorCode::InvalidVaultForNewDepositors,
        "Vault balance should be non-zero for new stakers to enter"
    )?;

    apply_rebase_to_vault(vault_amount, vault)?;
    apply_rebase_to_vault_depositor(vault_depositor, vault)?;

    let vault_shares_before = vault_depositor.checked_vault_shares(vault)?;
    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;

    let n_shares = vault_amount_to_vault_shares(
        amount,
        vault.total_shares,
        vault_amount,
    )?;

    // reset cost basis if no shares
    vault_depositor.cost_basis = if vault_shares_before == 0 {
        amount.cast()?
    } else {
        vault_depositor.cost_basis.safe_add(amount.cast()?)?
    };

    vault_depositor.increase_vault_shares(n_shares, vault)?;

    vault.total_shares =
        vault.total_shares.safe_add(n_shares)?;

    vault.user_shares =
        vault.user_shares.safe_add(n_shares)?;

    if vault.market_index == 0 {
        user_stats.vault_staked_quote_asset_amount = vault_shares_to_vault_amount(
            vault_depositor.checked_vault_shares(vault)?,
            vault.total_shares,
            vault_amount.safe_add(amount)?,
        )?;
    }

    let vault_shares_after = vault_depositor.checked_vault_shares(vault)?;

    emit!(VaultDepositorRecord {
        ts: now,
        user_authority: user_stats.authority,
        action: VaultDepositorAction::Stake,
        amount,
        market_index: vault.market_index,
        vault_amount_before: vault_amount,
        vault_shares_before,
        user_vault_shares_before,
        total_vault_shares_before,
        vault_shares_after,
        total_vault_shares_after: vault.total_shares,
        user_vault_shares_after: vault.user_shares,
    });

    Ok(())
}

pub fn apply_rebase_to_vault(
    vault_balance: u64,
    vault: &mut Vault,
) -> DriftResult {
    if vault_balance != 0
        && vault_balance.cast::<u128>()? < vault.total_shares
    {
        let (expo_diff, rebase_divisor) = calculate_rebase_info(
            vault.total_shares,
            vault_balance,
        )?;

        vault.total_shares = vault
            .total_shares
            .safe_div(rebase_divisor)?;
        vault.user_shares = vault
            .user_shares
            .safe_div(rebase_divisor)?;
        vault.shares_base = vault
            .shares_base
            .safe_add(expo_diff.cast::<u128>()?)?;

        msg!("rebasing vault: expo_diff={}", expo_diff);
    }

    if vault_balance != 0 && vault.total_shares == 0 {
        vault.total_shares = vault_balance.cast::<u128>()?;
    }

    Ok(())
}

pub fn apply_rebase_to_vault_depositor(
    vault_depositor: &mut VaultDepositor,
    vault: &mut Vault,
) -> DriftResult {
    if vault.shares_base != vault_depositor.vault_base {
        validate!(
            vault.shares_base > vault_depositor.vault_base,
            ErrorCode::InvalidVaultRebase,
            "Rebase expo out of bounds"
        )?;

        let expo_diff = (vault.shares_base - vault_depositor.vault_base)
            .cast::<u32>()?;

        let rebase_divisor = 10_u128.pow(expo_diff);

        msg!(
            "rebasing vault depositor: base: {} -> {} ",
            vault_depositor.vault_base,
            vault.shares_base,
        );

        vault_depositor.vault_base = vault.shares_base;

        let old_vault_shares = vault_depositor.unchecked_vault_shares();
        let new_vault_shares = old_vault_shares.safe_div(rebase_divisor)?;

        msg!(
            "rebasing vault depositor: shares -> {} ",
            new_vault_shares
        );

        vault_depositor.update_vault_shares(new_vault_shares, vault)?;

        vault_depositor.last_withdraw_request_shares = vault_depositor
            .last_withdraw_request_shares
            .safe_div(rebase_divisor)?;
    }

    Ok(())
}

pub fn request_remove_vault_depositor(
    n_shares: u128,
    vault_amount: u64,
    vault_depositor: &mut VaultDepositor,
    user_stats: &mut UserStats,
    vault: &mut Vault,
    now: i64,
) -> DriftResult {
    msg!("n_shares {}", n_shares);
    vault_depositor.last_withdraw_request_shares = n_shares;

    apply_rebase_to_vault(vault_amount, vault)?;
    apply_rebase_to_vault_depositor(vault_depositor, vault)?;

    let vault_shares_before = vault_depositor.checked_vault_shares(vault)?;
    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;

    validate!(
        vault_depositor.last_withdraw_request_shares
            <= vault_depositor.checked_vault_shares(vault)?,
        ErrorCode::InvalidVaultWithdrawSize,
        "last_withdraw_request_shares exceeds vault_shares {} > {}",
        vault_depositor.last_withdraw_request_shares,
        vault_depositor.checked_vault_shares(vault)?
    )?;

    validate!(
        vault_depositor.vault_base == vault.shares_base,
        ErrorCode::InvalidVaultRebase,
        "if stake base != spot market base"
    )?;

    vault_depositor.last_withdraw_request_value = vault_shares_to_vault_amount(
        vault_depositor.last_withdraw_request_shares,
        vault.total_shares,
        vault_amount,
    )?
    .min(vault_amount.saturating_sub(1));

    validate!(
        vault_depositor.last_withdraw_request_value == 0
            || vault_depositor.last_withdraw_request_value < vault_amount,
        ErrorCode::InvalidIFUnstakeSize,
        "Requested withdraw value is not below vault balance"
    )?;

    let vault_shares_after = vault_depositor.checked_vault_shares(vault)?;

    if vault.market_index == 0 {
        user_stats.vault_staked_quote_asset_amount = vault_shares_to_vault_amount(
            vault_depositor.checked_vault_shares(vault)?,
            vault.total_shares,
            vault_amount,
        )?;
    }

    emit!(VaultDepositorRecord {
        ts: now,
        user_authority: user_stats.authority,
        action: VaultDepositorAction::WithdrawRequest,
        amount: vault_depositor.last_withdraw_request_value,
        market_index: vault.market_index,
        vault_amount_before: vault_amount,
        vault_shares_before,
        user_vault_shares_before,
        total_vault_shares_before,
        vault_shares_after,
        total_vault_shares_after: vault.total_shares,
        user_vault_shares_after: vault.user_shares,
    });

    vault_depositor.last_withdraw_request_ts = now;

    Ok(())
}

pub fn cancel_request_remove_vault_depositor(
    vault_amount: u64,
    vault_depositor: &mut VaultDepositor,
    user_stats: &mut UserStats,
    vault: &mut Vault,
    now: i64,
) -> DriftResult {
    apply_rebase_to_vault(vault_amount, vault)?;
    apply_rebase_to_vault_depositor(vault_depositor, vault)?;

    let vault_shares_before = vault_depositor.checked_vault_shares(vault)?;
    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;

    validate!(
        vault_depositor.vault_base == vault.shares_base,
        ErrorCode::InvalidVaultRebase,
        "if stake base != spot market base"
    )?;

    validate!(
        vault_depositor.last_withdraw_request_shares != 0,
        ErrorCode::InvalidVaultDepositorWithdrawCancel,
        "No withdraw request in progress"
    )?;

    let vault_shares_lost =
        calculate_vault_shares_lost(vault_depositor, vault, vault_amount)?;

    vault_depositor.decrease_vault_shares(vault_shares_lost, vault)?;

    vault.total_shares = vault
        .total_shares
        .safe_sub(vault_shares_lost)?;

    vault.user_shares = vault
        .user_shares
        .safe_sub(vault_shares_lost)?;

    let vault_shares_after = vault_depositor.checked_vault_shares(vault)?;

    if vault.market_index == 0 {
        user_stats.vault_staked_quote_asset_amount = vault_shares_to_vault_amount(
            vault_shares_after,
            vault.total_shares,
            vault_amount,
        )?;
    }

    emit!(VaultDepositorRecord {
        ts: now,
        user_authority: user_stats.authority,
        action: VaultDepositorAction::WithdrawCancelRequest,
        amount: 0,
        market_index: vault.market_index,
        vault_amount_before: vault_amount,
        vault_shares_before,
        user_vault_shares_before,
        total_vault_shares_before,
        vault_shares_after,
        total_vault_shares_after: vault.total_shares,
        user_vault_shares_after: vault.user_shares,
    });

    vault_depositor.last_withdraw_request_shares = 0;
    vault_depositor.last_withdraw_request_value = 0;
    vault_depositor.last_withdraw_request_ts = now;

    Ok(())
}

pub fn remove_vault_depositor(
    vault_amount: u64,
    vault_depositor: &mut VaultDepositor,
    user_stats: &mut UserStats,
    vault: &mut Vault,
    now: i64,
) -> DriftResult<u64> {
    let time_since_withdraw_request =
        now.safe_sub(vault_depositor.last_withdraw_request_ts)?;

    validate!(
        time_since_withdraw_request >= vault.unstaking_period,
        ErrorCode::TryingToRemoveLiquidityTooFast
    )?;

    apply_rebase_to_vault(vault_amount, vault)?;
    apply_rebase_to_vault_depositor(vault_depositor, vault)?;

    let vault_shares_before = vault_depositor.checked_vault_shares(vault)?;
    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;

    let n_shares = vault_depositor.last_withdraw_request_shares;

    validate!(
        n_shares > 0,
        ErrorCode::InvalidIFUnstake,
        "Must submit withdraw request and wait the escrow period"
    )?;

    validate!(
        vault_shares_before >= n_shares,
        ErrorCode::InsufficientIFShares
    )?;

    let amount = vault_shares_to_vault_amount(
        n_shares,
        vault.total_shares,
        vault_amount,
    )?;

    let _vault_shares_lost =
        calculate_vault_shares_lost(vault_depositor, vault, vault_amount)?;

    let withdraw_amount = amount.min(vault_depositor.last_withdraw_request_value);

    vault_depositor.decrease_vault_shares(n_shares, vault)?;

    vault_depositor.cost_basis = vault_depositor
        .cost_basis
        .safe_sub(withdraw_amount.cast()?)?;

    vault.total_shares =
        vault.total_shares.safe_sub(n_shares)?;

    vault.user_shares =
        vault.user_shares.safe_sub(n_shares)?;

    // reset vault_depositor withdraw request info
    vault_depositor.last_withdraw_request_shares = 0;
    vault_depositor.last_withdraw_request_value = 0;
    vault_depositor.last_withdraw_request_ts = now;

    let vault_shares_after = vault_depositor.checked_vault_shares(vault)?;

    if vault.market_index == 0 {
        user_stats.vault_staked_quote_asset_amount = vault_shares_to_vault_amount(
            vault_shares_after,
            vault.total_shares,
            vault_amount.safe_sub(amount)?,
        )?;
    }

    emit!(VaultDepositorRecord {
        ts: now,
        user_authority: user_stats.authority,
        action: VaultDepositorAction::Withdraw,
        amount: withdraw_amount,
        market_index: vault.market_index,
        vault_amount_before: vault_amount,
        vault_shares_before,
        user_vault_shares_before,
        total_vault_shares_before,
        vault_shares_after,
        total_vault_shares_after: vault.total_shares,
        user_vault_shares_after: vault.user_shares,
    });

    Ok(withdraw_amount)
}

pub fn admin_remove_vault_depositor(
    vault_amount: u64,
    n_shares: u128,
    vault: &mut Vault,
    now: i64,
    admin_pubkey: Pubkey,
) -> DriftResult<u64> {
    apply_rebase_to_vault(vault_amount, vault)?;

    let total_vault_shares_before = vault.total_shares;
    let user_vault_shares_before = vault.user_shares;

    let vault_shares_before = total_vault_shares_before.safe_sub(user_vault_shares_before)?;

    validate!(
        vault_shares_before >= n_shares,
        ErrorCode::InsufficientIFShares,
        "vault_shares_before={} < n_shares={}",
        vault_shares_before,
        n_shares
    )?;

    let withdraw_amount = vault_shares_to_vault_amount(
        n_shares,
        vault.total_shares,
        vault_amount,
    )?;

    vault.total_shares =
        vault.total_shares.safe_sub(n_shares)?;

    let vault_shares_after = vault.total_shares;

    emit!(VaultDepositorRecord {
        ts: now,
        user_authority: admin_pubkey,
        action: VaultDepositorAction::Withdraw,
        amount: withdraw_amount,
        market_index: vault.market_index,
        vault_amount_before: vault_amount,
        vault_shares_before,
        user_vault_shares_before,
        total_vault_shares_before,
        vault_shares_after,
        total_vault_shares_after: vault.total_shares,
        user_vault_shares_after: vault.user_shares,
    });

    Ok(withdraw_amount)
}
