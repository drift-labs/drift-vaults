#[cfg(test)]
mod vault_fcn {
    use crate::withdraw_request::WithdrawRequest;
    use crate::{Vault, VaultDepositor, WithdrawUnit};
    use anchor_lang::prelude::Pubkey;
    use drift::math::constants::{ONE_YEAR, QUOTE_PRECISION_U64};
    use drift::math::insurance::if_shares_to_vault_amount as depositor_shares_to_vault_amount;

    #[test]
    fn test_manager_withdraw() {
        let now = 0;
        let vault = &mut Vault::default();
        vault.management_fee = 1000; // 10 bps
        vault.redeem_period = 60;

        let mut vault_equity = 0;
        let amount = 100_000_000; // $100
        vault.manager_deposit(amount, vault_equity, now).unwrap();
        vault_equity += amount;
        vault_equity -= 1;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        assert_eq!(vault.total_deposits, 100000000);
        assert_eq!(vault.manager_total_deposits, 100000000);
        assert_eq!(vault.manager_total_withdraws, 0);

        vault
            .manager_request_withdraw(amount - 1, WithdrawUnit::Token, vault_equity, now)
            .unwrap();

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        assert_eq!(vault.total_deposits, 100000000);
        assert_eq!(vault.manager_total_deposits, 100000000);
        assert_eq!(vault.manager_total_withdraws, 0);

        let err = vault.manager_withdraw(vault_equity, now + 50).is_err();
        assert!(err);

        let withdraw = vault.manager_withdraw(vault_equity, now + 60).unwrap();
        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.total_deposits, 100000000);
        assert_eq!(vault.manager_total_deposits, 100000000);
        assert_eq!(vault.manager_total_withdraws, 99999999);
        assert_eq!(withdraw, 99999999);
    }

    #[test]
    fn test_smol_management_fee() {
        let now = 0;
        let vault = &mut Vault::default();
        vault.management_fee = 1000; // 10 bps

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.last_fee_update_ts, 0);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now).unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);
        assert_eq!(vault.last_fee_update_ts, 0);
        vault_equity += amount;

        let user_eq_before =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(user_eq_before, 100000000);

        vault
            .apply_management_fee(vault_equity, now + ONE_YEAR as i64)
            .unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200200200);

        let oo =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(oo, 99900000);

        assert_eq!(vault.last_fee_update_ts, now + ONE_YEAR as i64);
    }

    #[test]
    fn test_excessive_management_fee() {
        let now = 1000;
        let vault = &mut Vault::default();
        vault.management_fee = 1000000;
        vault.last_fee_update_ts = 0;

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.last_fee_update_ts, 0);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now).unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);
        assert_eq!(vault.shares_base, 0);
        assert_eq!(vault.last_fee_update_ts, 1000);
        vault_equity += amount;

        vault
            .apply_management_fee(vault_equity, now + ONE_YEAR as i64)
            .unwrap();
        assert_eq!(vault.user_shares, 10);
        assert_eq!(vault.total_shares, 2000000000);
        assert_eq!(vault.shares_base, 7);

        let vd_amount_left =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(vd_amount_left, 1);
        assert_eq!(vault.last_fee_update_ts, now + ONE_YEAR as i64);
    }

    #[test]
    fn test_management_fee_high_frequency() {
        // asymtopic nature of calling -100% annualized on shorter time scale
        let mut now = 0;
        let vault = &mut Vault::default();
        vault.management_fee = 1000000; // 100%
        vault.last_fee_update_ts = 0;

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.last_fee_update_ts, 0);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now).unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);
        assert_eq!(vault.shares_base, 0);
        // assert_eq!(vault.last_fee_update_ts, 1000);
        vault_equity += amount;

        while now < ONE_YEAR as i64 {
            vault.apply_management_fee(vault_equity, now).unwrap();
            now += 60 * 60 * 24 * 7; // every week
        }
        vault.apply_management_fee(vault_equity, now).unwrap();

        let vd_amount_left =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(vd_amount_left, 35832760); // ~$35
        assert_eq!(vault.last_fee_update_ts, now);
    }

    #[test]
    fn test_manager_alone_deposit_withdraw() {
        let mut now = 123456789;
        let vault = &mut Vault::default();
        vault.management_fee = 100; // .01%
        vault.last_fee_update_ts = now;
        let mut vault_equity: u64 = 0;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vault.manager_deposit(amount, vault_equity, now).unwrap();
        vault_equity += amount;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        now += 60 * 60;

        let vault_manager_amount = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount, 100000000);

        vault
            .manager_request_withdraw(amount, WithdrawUnit::Token, vault_equity, now)
            .unwrap();

        let withdrew = vault.manager_withdraw(vault_equity, now).unwrap();
        assert_eq!(amount, withdrew);
        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 0);

        let vault_manager_amount_after = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount_after, 0);
    }
    #[test]
    fn test_negative_management_fee() {
        let now = 0;
        let vault = &mut Vault::default();
        vault.management_fee = -2_147_483_648; // -214700% annualized (manager pays 24% hourly, .4% per minute)

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.last_fee_update_ts, 0);

        let mut vault_equity: u64 = 100 * QUOTE_PRECISION_U64;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vd.deposit(amount, vault_equity, vault, now).unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 200000000);
        assert_eq!(vault.last_fee_update_ts, 0);
        vault_equity += amount;

        let user_eq_before =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(user_eq_before, 100000000);

        // one second since inception
        vault
            .apply_management_fee(vault_equity, now + 1_i64)
            .unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 199986200);

        let oo =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(oo, 100006900); // up half a cent

        // one minute since inception
        vault
            .apply_management_fee(vault_equity, now + 60_i64)
            .unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 199185855);

        let oo =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(oo, 100408736); // up 40 cents

        // one year since inception
        vault
            .apply_management_fee(vault_equity, now + ONE_YEAR as i64)
            .unwrap();
        assert_eq!(vault.user_shares, 100000000);
        assert_eq!(vault.total_shares, 100000000);

        let oo =
            depositor_shares_to_vault_amount(vault.user_shares, vault.total_shares, vault_equity)
                .unwrap();
        assert_eq!(oo, 200000000); // up $100

        assert_eq!(vault.last_fee_update_ts, now + ONE_YEAR as i64);
    }

    #[test]
    fn test_negative_management_fee_manager_alone() {
        let mut now = 0;
        let vault = &mut Vault::default();
        vault.management_fee = -2_147_483_648; // -214700% annualized (manager pays 24% hourly, .4% per minute)
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.last_fee_update_ts, 0);

        let mut vault_equity: u64 = 0;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        now += 100000;
        vault.manager_deposit(amount, vault_equity, now).unwrap();

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, amount as u128);
        assert_eq!(vault.last_fee_update_ts, now);
        vault_equity += amount;

        now += 100000;
        vault
            .manager_request_withdraw(amount, WithdrawUnit::Token, vault_equity, now)
            .unwrap();
        let withdrew = vault.manager_withdraw(vault_equity, now).unwrap();
        assert_eq!(withdrew, amount);
    }

    #[test]
    fn test_manager_deposit_withdraw_with_user_flat() {
        let mut now = 123456789;
        let vault = &mut Vault::default();
        vault.management_fee = 0;
        vault.profit_share = 150000; // 15%

        vault.last_fee_update_ts = now;
        let mut vault_equity: u64 = 0;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vault.manager_deposit(amount, vault_equity, now).unwrap();
        vault_equity += amount;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        now += 60 * 60;

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        vd.deposit(amount * 20, vault_equity, vault, now).unwrap(); // new user deposits $2000
        now += 60 * 60;
        assert_eq!(vault.user_shares, 2000000000);
        assert_eq!(vault.total_shares, 2000000000 + 100000000);
        vault_equity += amount * 20;

        now += 60 * 60 * 24; // 1 day later

        vd.apply_profit_share(vault_equity, vault).unwrap();
        vault.apply_management_fee(vault_equity, now).unwrap();

        let vault_manager_amount = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount, 100000000);
        vault
            .manager_request_withdraw(amount, WithdrawUnit::Token, vault_equity, now)
            .unwrap();

        let withdrew = vault.manager_withdraw(vault_equity, now).unwrap();
        assert_eq!(amount, withdrew);
        assert_eq!(vault.user_shares, 2000000000);
        assert_eq!(vault.total_shares, 2000000000);

        let vault_manager_amount_after = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount_after, 0);
    }

    #[test]
    fn test_manager_deposit_withdraw_with_user_manager_fee_loss() {
        let mut now = 123456789;
        let vault = &mut Vault::default();
        vault.management_fee = 100; // .01%
        vault.profit_share = 150000; // 15%

        vault.last_fee_update_ts = now;
        let mut vault_equity: u64 = 0;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vault.manager_deposit(amount, vault_equity, now).unwrap();
        vault_equity += amount;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        now += 60 * 60;

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        vd.deposit(amount * 20, vault_equity, vault, now).unwrap(); // new user deposits $2000
        now += 60 * 60;
        assert_eq!(vault.user_shares, 2000000000);
        assert_eq!(vault.total_shares, 2000000000 + 100000000);
        vault_equity += amount * 20;

        let mut cnt = 0;
        while (vault.total_shares == 2000000000 + 100000000) && cnt < 400 {
            now += 60 * 60 * 24; // 1 day later

            vd.apply_profit_share(vault_equity, vault).unwrap();
            vault.apply_management_fee(vault_equity, now).unwrap();
            // crate::msg!("vault last ts: {} vs {}", vault.last_fee_update_ts, now);
            cnt += 1;
        }

        assert_eq!(cnt, 4); // 4 days

        let vault_manager_amount = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount, 100001999);
        vault
            .manager_request_withdraw(amount, WithdrawUnit::Token, vault_equity, now)
            .unwrap();

        let withdrew = vault.manager_withdraw(vault_equity, now).unwrap();
        assert_eq!(amount, withdrew);
        assert_eq!(vault.user_shares, 2000000000);
        assert_eq!(vault.total_shares, 2000002000);
        vault_equity -= withdrew;

        let vault_manager_amount_after = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount_after, 1999); // gainz

        let vd_amount = depositor_shares_to_vault_amount(
            vd.checked_vault_shares(vault).unwrap(),
            vault.total_shares,
            vault_equity,
        )
        .unwrap();
        assert_eq!(vd_amount, 1999998000); // loss

        assert_eq!(vd_amount + vault_manager_amount_after, vault_equity - 1);
    }

    #[test]
    fn test_manager_deposit_withdraw_with_user_gain() {
        let mut now = 123456789;
        let vault = &mut Vault::default();
        vault.management_fee = 100; // .01%
        vault.profit_share = 150000; // 15%

        vault.last_fee_update_ts = now;
        let mut vault_equity: u64 = 0;
        let amount: u64 = 100 * QUOTE_PRECISION_U64;
        vault.manager_deposit(amount, vault_equity, now).unwrap();
        vault_equity += amount;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 100000000);
        now += 60 * 60;

        let vd =
            &mut VaultDepositor::new(Pubkey::default(), Pubkey::default(), Pubkey::default(), now);
        vd.deposit(amount * 20, vault_equity, vault, now).unwrap(); // new user deposits $2000
        now += 60 * 60;
        assert_eq!(vault.user_shares, 2000000000);
        assert_eq!(vault.total_shares, 2000000000 + 100000000);
        vault_equity += amount * 20;

        // up 50%
        vault_equity *= 3;
        vault_equity /= 2;

        assert_eq!(vault_equity, 3_150_000_000);

        let mut cnt = 0;
        while (vault.total_shares == 2000000000 + 100000000) && cnt < 400 {
            now += 60 * 60 * 24; // 1 day later

            vd.apply_profit_share(vault_equity, vault).unwrap();
            vault.apply_management_fee(vault_equity, now).unwrap();
            // crate::msg!("vault last ts: {} vs {}", vault.last_fee_update_ts, now);
            cnt += 1;
        }

        assert_eq!(cnt, 4); // 4 days
        assert_eq!(
            vd.cumulative_profit_share_amount,
            (1000 * QUOTE_PRECISION_U64) as i64
        );
        assert_eq!(vd.net_deposits, (2000 * QUOTE_PRECISION_U64) as i64);

        let vault_manager_amount = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount, 300002849); //$300??

        vault
            .manager_request_withdraw(amount, WithdrawUnit::Token, vault_equity, now)
            .unwrap();
        assert_eq!(amount, vault.last_manager_withdraw_request.value);

        let withdrew = vault.manager_withdraw(vault_equity, now).unwrap();
        assert_eq!(amount - 1, withdrew); // todo: slight round out of favor
        assert_eq!(vault.user_shares, 1900000000);
        assert_eq!(vault.total_shares, 2033335367);
        vault_equity -= withdrew;

        let vault_manager_amount_after = depositor_shares_to_vault_amount(
            vault.total_shares - vault.user_shares,
            vault.total_shares,
            vault_equity,
        )
        .unwrap();

        assert_eq!(vault_manager_amount_after, 200_002_850); // gainz

        let vd_amount = depositor_shares_to_vault_amount(
            vd.checked_vault_shares(vault).unwrap(),
            vault.total_shares,
            vault_equity,
        )
        .unwrap();
        assert_eq!(vd_amount, 2_849_997_150); // gainz

        assert_eq!(vd_amount + vault_manager_amount_after, vault_equity - 1);
    }

    #[test]
    fn test_vd_request_withdraw_after_rebase() {
        let mut now = 123456789;
        let vault = &mut Vault::default();

        let mut vault_equity: u64 = 0;
        let deposit_amount: u64 = 100 * QUOTE_PRECISION_U64;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.shares_base, 0);

        let vd = &mut VaultDepositor::new(
            Pubkey::default(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            now,
        );
        vd.deposit(deposit_amount, vault_equity, vault, now)
            .unwrap(); // new user deposits $2000
        let vd_shares = vd.checked_vault_shares(vault).unwrap();
        now += 100;
        assert_eq!(vault.user_shares, deposit_amount as u128);
        assert_eq!(vault.total_shares, deposit_amount as u128);
        assert_eq!(vault.shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), vault.user_shares);
        assert_eq!(vd.vault_shares_base, vault.shares_base);
        vault_equity += deposit_amount;

        // down 99.9%
        vault_equity /= 1000;
        now += 100;

        // request_withdraw triggers rebase
        vd.request_withdraw(
            vd_shares as u64,
            WithdrawUnit::Shares,
            vault_equity,
            vault,
            now,
        )
        .expect("request withdraw");

        assert_eq!(
            vd.last_withdraw_request,
            WithdrawRequest {
                shares: vd_shares / 100, // expected rebase by expo_diff 2
                value: vault_equity,
                ts: now,
            }
        );

        println!(
            "last_withdraw_request 1: {:?}, vault eq: {}",
            vd.last_withdraw_request, vault_equity
        );

        // // down another 50%
        // vault_equity /= 2;
        now += 100;

        let (withdraw_amount, finishing_liquidation) =
            vd.withdraw(vault_equity, vault, now).expect("withdraw");
        assert_eq!(withdraw_amount, vault_equity);
        println!(
            "final withdraw_amount 1: {}, vault eq: {}",
            withdraw_amount, vault_equity
        );
        assert!(!finishing_liquidation);
    }

    #[test]
    fn test_vd_request_withdraw_before_rebase() {
        let mut now = 123456789;
        let vault = &mut Vault::default();

        let mut vault_equity: u64 = 0;
        let deposit_amount: u64 = 100 * QUOTE_PRECISION_U64;

        assert_eq!(vault.user_shares, 0);
        assert_eq!(vault.total_shares, 0);
        assert_eq!(vault.shares_base, 0);

        let vd = &mut VaultDepositor::new(
            Pubkey::default(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            now,
        );
        vd.deposit(deposit_amount, vault_equity, vault, now)
            .unwrap(); // new user deposits $2000
        let vd_shares = vd.checked_vault_shares(vault).unwrap();
        now += 100;
        assert_eq!(vault.user_shares, deposit_amount as u128);
        assert_eq!(vault.total_shares, deposit_amount as u128);
        assert_eq!(vault.shares_base, 0);
        assert_eq!(vd.checked_vault_shares(vault).unwrap(), vault.user_shares);
        assert_eq!(vd.vault_shares_base, vault.shares_base);
        vault_equity += deposit_amount;

        vd.request_withdraw(
            vd_shares as u64,
            WithdrawUnit::Shares,
            vault_equity,
            vault,
            now,
        )
        .expect("request withdraw");

        assert_eq!(
            vd.last_withdraw_request,
            WithdrawRequest {
                shares: vd_shares,
                value: vault_equity,
                ts: now,
            }
        );
        println!(
            "last_withdraw_request 2: {:?}, vault equity: {}",
            vd.last_withdraw_request, vault_equity
        );

        // down 99.9%
        vault_equity /= 1000;
        now += 100;

        // withdraw will trigger a rebase
        let (withdraw_amount, finishing_liquidation) =
            vd.withdraw(vault_equity, vault, now).expect("withdraw");
        assert_eq!(withdraw_amount, vault_equity);
        println!(
            "final withdraw_amount 2: {}, vault eq: {}",
            withdraw_amount, vault_equity
        );
        assert!(!finishing_liquidation);
    }
}
