use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use drift::cpi::accounts::{InitializeUser, InitializeUserStats};
use drift::math::casting::Cast;
use drift::math::constants::PERCENTAGE_PRECISION_U64;
use drift::program::Drift;
use drift::state::spot_market::SpotMarket;

use crate::constants::ONE_DAY;
use crate::drift_cpi::InitializeUserCPI;
use crate::state::{Vault, VaultProtocol};
use crate::{error::ErrorCode, validate, Size};

pub fn initialize_vault<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, InitializeVault<'info>>,
    params: VaultParams,
) -> Result<()> {
    let bump = ctx.bumps.vault;

    let mut vault = ctx.accounts.vault.load_init()?;
    vault.name = params.name;
    vault.pubkey = *ctx.accounts.vault.to_account_info().key;
    vault.manager = *ctx.accounts.manager.key;
    vault.user_stats = *ctx.accounts.drift_user_stats.key;
    vault.user = *ctx.accounts.drift_user.key;
    vault.token_account = *ctx.accounts.token_account.to_account_info().key;
    vault.spot_market_index = params.spot_market_index;
    vault.init_ts = Clock::get()?.unix_timestamp;

    let mut vp_loader = init_vault_protocol(&ctx)?;
    let vp = vp_loader.as_mut().map(|vp| vp.load_init()).transpose()?;

    validate!(
        params.redeem_period < ONE_DAY * 90,
        ErrorCode::InvalidVaultInitialization,
        "redeem period must be < 90 days"
    )?;
    vault.redeem_period = params.redeem_period;

    vault.max_tokens = params.max_tokens;
    vault.min_deposit_amount = params.min_deposit_amount;

    if let (Some(mut vp), Some(vp_params)) = (vp, params.vault_protocol) {
        validate!(
            params
                .management_fee
                .saturating_add(vp_params.protocol_fee.cast::<i64>()?)
                < PERCENTAGE_PRECISION_U64.cast()?,
            ErrorCode::InvalidVaultInitialization,
            "management fee plus protocol fee must be < 100%"
        )?;
        vault.management_fee = params.management_fee;
        vp.protocol_fee = vp_params.protocol_fee;

        validate!(
            params
                .profit_share
                .saturating_add(vp_params.protocol_profit_share)
                < PERCENTAGE_PRECISION_U64.cast()?,
            ErrorCode::InvalidVaultInitialization,
            "manager profit share protocol profit share must be < 100%"
        )?;
        vault.profit_share = params.profit_share;
        vp.protocol_profit_share = vp_params.protocol_profit_share;
        vp.protocol = vp_params.protocol;

        let (vault_protocol, vp_bump) = Pubkey::find_program_address(
            &[b"vault_protocol", ctx.accounts.vault.key().as_ref()],
            ctx.program_id,
        );
        vp.bump = vp_bump;

        vault.vault_protocol = vault_protocol;
    } else {
        validate!(
            params.management_fee < PERCENTAGE_PRECISION_U64.cast()?,
            ErrorCode::InvalidVaultInitialization,
            "management fee plus protocol fee must be < 100%"
        )?;
        vault.management_fee = params.management_fee;

        validate!(
            params.profit_share < PERCENTAGE_PRECISION_U64.cast()?,
            ErrorCode::InvalidVaultInitialization,
            "manager profit share protocol profit share must be < 100%"
        )?;
        vault.profit_share = params.profit_share;

        vault.vault_protocol = Pubkey::default();
    }

    validate!(
        params.hurdle_rate == 0,
        ErrorCode::InvalidVaultInitialization,
        "hurdle rate not implemented"
    )?;
    vault.hurdle_rate = params.hurdle_rate;
    vault.bump = bump;
    vault.permissioned = params.permissioned;

    drop(vault);

    // anchor calls this at the end of instructions to initialize the discriminator of any new account.
    // since we manually implemented #[account(init, ...)] for our remaining account, we have to manually
    // call exit to init the discriminator, otherwise it remains set to zero.
    vp_loader.exit(ctx.program_id)?;

    ctx.drift_initialize_user_stats(params.name, bump)?;
    ctx.drift_initialize_user(params.name, bump)?;

    Ok(())
}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub struct VaultParams {
    pub name: [u8; 32],
    pub redeem_period: i64,
    pub max_tokens: u64,
    pub management_fee: i64,
    pub min_deposit_amount: u64,
    pub profit_share: u32,
    pub hurdle_rate: u32,
    pub spot_market_index: u16,
    pub permissioned: bool,
    pub vault_protocol: Option<VaultProtocolParams>,
}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize, PartialEq, Eq)]
pub struct VaultProtocolParams {
    pub protocol: Pubkey,
    pub protocol_fee: u64,
    pub protocol_profit_share: u32,
}

#[derive(Accounts)]
#[instruction(params: VaultParams)]
pub struct InitializeVault<'info> {
    #[account(
      init,
      seeds = [b"vault", params.name.as_ref()],
      space = Vault::SIZE,
      bump,
      payer = payer
    )]
    pub vault: AccountLoader<'info, Vault>,
    #[account(
      init,
      seeds = [b"vault_token_account".as_ref(), vault.key().as_ref()],
      bump,
      payer = payer,
      token::mint = drift_spot_market_mint,
      token::authority = vault
    )]
    pub token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_user_stats: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_user: AccountInfo<'info>,
    /// CHECK: checked in drift cpi
    #[account(mut)]
    pub drift_state: AccountInfo<'info>,
    #[account(
        constraint = drift_spot_market.load()?.market_index == params.spot_market_index
    )]
    pub drift_spot_market: AccountLoader<'info, SpotMarket>,
    #[account(
        constraint = drift_spot_market.load()?.mint.eq(&drift_spot_market_mint.key())
    )]
    pub drift_spot_market_mint: Box<Account<'info, Mint>>,
    pub manager: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub drift_program: Program<'info, Drift>,
    pub token_program: Program<'info, Token>,
}

impl<'info> InitializeUserCPI for Context<'_, '_, '_, 'info, InitializeVault<'info>> {
    fn drift_initialize_user(&self, name: [u8; 32], bump: u8) -> Result<()> {
        let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
        let signers = &[&signature_seeds[..]];

        let cpi_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_accounts = InitializeUser {
            user_stats: self.accounts.drift_user_stats.clone(),
            user: self.accounts.drift_user.clone(),
            state: self.accounts.drift_state.clone(),
            authority: self.accounts.vault.to_account_info().clone(),
            payer: self.accounts.payer.to_account_info().clone(),
            rent: self.accounts.rent.to_account_info().clone(),
            system_program: self.accounts.system_program.to_account_info().clone(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
        let sub_account_id = 0_u16;
        drift::cpi::initialize_user(cpi_ctx, sub_account_id, name)?;

        Ok(())
    }

    fn drift_initialize_user_stats(&self, name: [u8; 32], bump: u8) -> Result<()> {
        let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
        let signers = &[&signature_seeds[..]];

        let cpi_program = self.accounts.drift_program.to_account_info().clone();
        let cpi_accounts = InitializeUserStats {
            user_stats: self.accounts.drift_user_stats.clone(),
            state: self.accounts.drift_state.clone(),
            authority: self.accounts.vault.to_account_info().clone(),
            payer: self.accounts.payer.to_account_info().clone(),
            rent: self.accounts.rent.to_account_info().clone(),
            system_program: self.accounts.system_program.to_account_info().clone(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signers);
        drift::cpi::initialize_user_stats(cpi_ctx)?;

        Ok(())
    }
}

// this function is needed because remaining accounts can't have account macro constraints,
// and we need to init the VaultProtocol account in the remaining accounts.
// this code is taken from `cargo expand` of what would be this accounts list used to init VaultProtocol:
// ```rust
// #[derive(Accounts)]
// struct InitializeVaultProtocol<'info> {
//     #[account(
//         init,
//         seeds = [b"vault_protocol", vault.key().as_ref()],
//         space = VaultProtocol::SIZE,
//         bump,
//         payer = payer
//     )]
//     pub vault_protocol: AccountLoader<'info, VaultProtocol>,
//     pub vault: AccountLoader<'info, Vault>,
//     #[account(mut)]
//     pub payer: Signer<'info>,
//     pub rent: Sysvar<'info, Rent>,
//     pub system_program: Program<'info, System>,
// }
// ```
fn init_vault_protocol<'c: 'info, 'info>(
    ctx: &Context<'_, '_, 'c, 'info, InitializeVault<'info>>,
) -> Result<Option<AccountLoader<'c, VaultProtocol>>> {
    let vp_acct_info = match ctx.remaining_accounts.last() {
        Some(acct) => acct,
        None => return Ok(None),
    };
    let vault = &ctx.accounts.vault;
    let payer = &ctx.accounts.payer;
    let system_program = &ctx.accounts.system_program;

    let __anchor_rent = Rent::get()?;

    let (__pda_address, __bump) =
        Pubkey::find_program_address(&[b"vault_protocol", vault.key().as_ref()], ctx.program_id);

    let vault_protocol: AccountLoader<VaultProtocol> = {
        let (__pda_address, __bump) = Pubkey::find_program_address(
            &[b"vault_protocol", vault.key().as_ref()],
            ctx.program_id,
        );
        if vp_acct_info.key() != __pda_address {
            return Err(
                anchor_lang::error::Error::from(error::ErrorCode::ConstraintSeeds)
                    .with_account_name("vault_protocol")
                    .with_pubkeys((vp_acct_info.key(), __pda_address)),
            );
        }

        let vault_protocol = {
            let actual_field = AsRef::<AccountInfo>::as_ref(vp_acct_info);
            let actual_owner = actual_field.owner;
            let space = VaultProtocol::SIZE;
            let pa: AccountLoader<VaultProtocol> =
                if actual_owner == &anchor_lang::solana_program::system_program::ID {
                    let __current_lamports = vp_acct_info.lamports();
                    if __current_lamports == 0 {
                        let space = space;
                        let lamports = __anchor_rent.minimum_balance(space);
                        let cpi_accounts = anchor_lang::system_program::CreateAccount {
                            from: payer.to_account_info(),
                            to: vp_acct_info.to_account_info(),
                        };
                        let cpi_context =
                            CpiContext::new(system_program.to_account_info(), cpi_accounts);
                        anchor_lang::system_program::create_account(
                            cpi_context.with_signer(&[&[
                                b"vault_protocol",
                                vault.key().as_ref(),
                                &[__bump][..],
                            ][..]]),
                            lamports,
                            space as u64,
                            ctx.program_id,
                        )?;
                    } else {
                        if payer.key() == vp_acct_info.key() {
                            return Err(error::Error::from(AnchorError {
                            error_name: error::ErrorCode::TryingToInitPayerAsProgramAccount.name(),
                            error_code_number: error::ErrorCode::TryingToInitPayerAsProgramAccount
                                .into(),
                            error_msg: error::ErrorCode::TryingToInitPayerAsProgramAccount
                                .to_string(),
                            error_origin: Some(ErrorOrigin::Source(Source {
                                filename:
                                    "programs/drift_vaults/src/instructions/initialize_vault.rs",
                                line: 131u32,
                            })),
                            compared_values: None,
                        })
                        .with_pubkeys((payer.key(), vp_acct_info.key())));
                        }
                        let required_lamports = __anchor_rent
                            .minimum_balance(space)
                            .max(1)
                            .saturating_sub(__current_lamports);
                        if required_lamports > 0 {
                            let cpi_accounts = anchor_lang::system_program::Transfer {
                                from: payer.to_account_info(),
                                to: vp_acct_info.to_account_info(),
                            };
                            let cpi_context =
                                CpiContext::new(system_program.to_account_info(), cpi_accounts);
                            anchor_lang::system_program::transfer(cpi_context, required_lamports)?;
                        }
                        let cpi_accounts = anchor_lang::system_program::Allocate {
                            account_to_allocate: vp_acct_info.to_account_info(),
                        };
                        let cpi_context =
                            CpiContext::new(system_program.to_account_info(), cpi_accounts);
                        anchor_lang::system_program::allocate(
                            cpi_context.with_signer(&[&[
                                b"vault_protocol",
                                vault.key().as_ref(),
                                &[__bump][..],
                            ][..]]),
                            space as u64,
                        )?;
                        let cpi_accounts = anchor_lang::system_program::Assign {
                            account_to_assign: vp_acct_info.to_account_info(),
                        };
                        let cpi_context =
                            CpiContext::new(system_program.to_account_info(), cpi_accounts);
                        anchor_lang::system_program::assign(
                            cpi_context.with_signer(&[&[
                                b"vault_protocol",
                                vault.key().as_ref(),
                                &[__bump][..],
                            ][..]]),
                            ctx.program_id,
                        )?;
                    }
                    match AccountLoader::try_from_unchecked(ctx.program_id, vp_acct_info) {
                        Ok(val) => val,
                        Err(e) => return Err(e.with_account_name("vault_protocol")),
                    }
                } else {
                    match AccountLoader::try_from(vp_acct_info) {
                        Ok(val) => val,
                        Err(e) => return Err(e.with_account_name("vault_protocol")),
                    }
                };
            pa
        };
        if !AsRef::<AccountInfo>::as_ref(&vault_protocol).is_writable {
            return Err(
                anchor_lang::error::Error::from(error::ErrorCode::ConstraintMut)
                    .with_account_name("vault_protocol"),
            );
        }
        if !__anchor_rent.is_exempt(
            vault_protocol.to_account_info().lamports(),
            vault_protocol.to_account_info().try_data_len()?,
        ) {
            return Err(error::Error::from(error::ErrorCode::ConstraintRentExempt)
                .with_account_name("vault_protocol"));
        }
        vault_protocol
    };

    Ok(Some(vault_protocol))
}
