#[cfg(test)]
mod vault_depositor {
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

        let admin_withdraw = vault
            .admin_withdraw(
                10 * QUOTE_PRECISION,
                WithdrawUnit::Token,
                vault_equity,
                now + 100,
            )
            .unwrap();
        assert_eq!(admin_withdraw, 10000000);
        assert_eq!(vault.total_shares, 100000000);
        vault_equity -= admin_withdraw;

        let admin_withdraw = vault
            .admin_withdraw(200000000, WithdrawUnit::Token, vault_equity, now + 100)
            .unwrap();
        assert_eq!(admin_withdraw, 200000000);
        assert_eq!(vault.total_shares, 0);
        vault_equity -= admin_withdraw;

        assert_eq!(vault_equity, 0);

        // back after profits
        let amount: u64 = 1000 * QUOTE_PRECISION_U64;
        assert_eq!(vd.net_deposits, -100000000);
        vd.deposit(amount, vault_equity, vault, now + 20).unwrap();
        assert_eq!(vd.net_deposits, 900000000);
        assert_eq!(vd.cumulative_profit_share_amount, 100_000_000);
        vault_equity = 5000 * QUOTE_PRECISION_U64; // up 400%
        vd.request_withdraw(
            5000 * QUOTE_PRECISION,
            WithdrawUnit::Token,
            vault_equity,
            vault,
            now + 20,
        )
        .unwrap();
        let withdraw_amount = vd.withdraw(vault_equity, vault, now + 20).unwrap();
        assert_eq!(withdraw_amount, vault_equity - 400 * QUOTE_PRECISION_U64);
        assert_eq!(vd.net_deposits, -4_100_000_000);
        assert_eq!(vd.cumulative_profit_share_amount, -vd.net_deposits); // 900?
    }

    #[test]
    fn test_management_fee() {
        let vault = &mut Vault::default();
        vault.get_date();
    }
}
