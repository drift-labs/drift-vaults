#[cfg(test)]
mod vault_fcn {
    use crate::{Vault, VaultDepositor, WithdrawUnit};
    use anchor_lang::prelude::Pubkey;
    use drift::math::constants::{ONE_YEAR, QUOTE_PRECISION_U64};
    use drift::math::insurance::if_shares_to_vault_amount as depositor_shares_to_vault_amount;

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
        let withdrew = vault
            .manager_withdraw(amount as u128, WithdrawUnit::Token, vault_equity, now)
            .unwrap();
        assert_eq!(withdrew, amount);
    }
}
