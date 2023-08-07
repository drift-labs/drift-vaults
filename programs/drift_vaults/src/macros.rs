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
