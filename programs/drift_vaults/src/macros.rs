#[macro_export]
macro_rules! validate {
        ($assert:expr, $err:expr) => {{
            if ($assert) {
                Ok(())
            } else {
                let error_code: ErrorCode = $err;
                msg!("Error {} thrown at {}:{}", error_code, file!(), line!());
                Err(error_code)
            }
        }};
        ($assert:expr, $err:expr, $($arg:tt)+) => {{
        if ($assert) {
            Ok(())
        } else {
            let error_code: ErrorCode = $err;
            msg!("Error {} thrown at {}:{}", error_code, file!(), line!());
            msg!($($arg)*);
            Err(error_code)
        }
    }};
}

#[macro_export]
macro_rules! declare_vault_seeds {
    ( $vault_loader:expr, $name: ident ) => {
        let vault = $vault_loader.load()?;
        let name = vault.name;
        let bump = vault.bump;
        let $name = &[&Vault::get_vault_signer_seeds(&name, &bump)[..]];
        drop(vault);
    };
}

#[macro_export]
macro_rules! implement_update_user_delegate_cpi {
    ( $self:expr, $delegate:expr ) => {
        declare_vault_seeds!($self.accounts.vault, seeds);

        let cpi_accounts = UpdateUser {
            user: $self.accounts.drift_user.to_account_info().clone(),
            authority: $self.accounts.vault.to_account_info().clone(),
        };

        let drift_program = $self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds);
        drift::cpi::update_user_delegate(cpi_context, 0, $delegate)?;
    };
}

#[macro_export]
macro_rules! implement_update_user_reduce_only_cpi {
    ( $self:expr, $reduce_only:expr ) => {
        declare_vault_seeds!($self.accounts.vault, seeds);

        let cpi_accounts = UpdateUser {
            user: $self.accounts.drift_user.to_account_info().clone(),
            authority: $self.accounts.vault.to_account_info().clone(),
        };

        let drift_program = $self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds);
        drift::cpi::update_user_reduce_only(cpi_context, 0, $reduce_only)?;
    };
}

#[macro_export]
macro_rules! implement_withdraw {
    ( $self:expr, $amount:expr ) => {
        declare_vault_seeds!($self.accounts.vault, seeds);

        let spot_market_index = $self.accounts.vault.load()?.spot_market_index;

        let cpi_accounts = DriftWithdraw {
            state: $self.accounts.drift_state.to_account_info().clone(),
            user: $self.accounts.drift_user.to_account_info().clone(),
            user_stats: $self.accounts.drift_user_stats.to_account_info().clone(),
            authority: $self.accounts.vault.to_account_info().clone(),
            spot_market_vault: $self
                .accounts
                .drift_spot_market_vault
                .to_account_info()
                .clone(),
            drift_signer: $self.accounts.drift_signer.to_account_info().clone(),
            user_token_account: $self.accounts.vault_token_account.to_account_info().clone(),
            token_program: $self.accounts.token_program.to_account_info().clone(),
        };

        let drift_program = $self.accounts.drift_program.to_account_info().clone();
        let cpi_context = CpiContext::new_with_signer(drift_program, cpi_accounts, seeds)
            .with_remaining_accounts($self.remaining_accounts.into());
        drift::cpi::withdraw(cpi_context, spot_market_index, $amount, false)?;
    };
}

#[macro_export]
macro_rules! implement_deposit {
    ( $self:expr, $amount:expr ) => {
        declare_vault_seeds!($self.accounts.vault, seeds);

        let spot_market_index = $self.accounts.vault.load()?.spot_market_index;

        let cpi_program = $self.accounts.drift_program.to_account_info().clone();
        let cpi_accounts = DriftDeposit {
            state: $self.accounts.drift_state.clone(),
            user: $self.accounts.drift_user.to_account_info().clone(),
            user_stats: $self.accounts.drift_user_stats.clone(),
            authority: $self.accounts.vault.to_account_info().clone(),
            spot_market_vault: $self
                .accounts
                .drift_spot_market_vault
                .to_account_info()
                .clone(),
            user_token_account: $self.accounts.vault_token_account.to_account_info().clone(),
            token_program: $self.accounts.token_program.to_account_info().clone(),
        };
        let cpi_context = CpiContext::new_with_signer(cpi_program, cpi_accounts, seeds)
            .with_remaining_accounts($self.remaining_accounts.into());
        drift::cpi::deposit(cpi_context, spot_market_index, $amount, false)?;
    };
}
