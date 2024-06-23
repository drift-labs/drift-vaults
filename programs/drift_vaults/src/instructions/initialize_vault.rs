use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use drift::cpi::accounts::{InitializeUser, InitializeUserStats};
use drift::math::casting::Cast;
use drift::math::constants::PERCENTAGE_PRECISION_U64;
use drift::program::Drift;
use drift::state::spot_market::SpotMarket;

use crate::{error::ErrorCode, Size, validate};
use crate::constants::ONE_DAY;
use crate::drift_cpi::InitializeUserCPI;
use crate::state::{Vault, VaultProtocol, VaultProtocolProvider};

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

  // backwards compatible: if last rem acct does not deserialize into [`VaultProtocol`] then it's a legacy vault.
  // let mut vp = ctx.vault_protocol();
  let mut vp: Option<AccountLoader<crate::state::VaultProtocol>> = None;
  
  let vp = vp.as_mut().map(|vp| vp.load_mut()).transpose()?;

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
        params.management_fee + vp_params.protocol_fee.cast::<i64>()? < PERCENTAGE_PRECISION_U64.cast()?,
        ErrorCode::InvalidVaultInitialization,
        "management fee plus protocol fee must be < 100%"
    )?;
    vault.management_fee = params.management_fee;
    vp.protocol_fee = vp_params.protocol_fee;

    validate!(
        params.profit_share + vp_params.protocol_profit_share < PERCENTAGE_PRECISION_U64.cast()?,
        ErrorCode::InvalidVaultInitialization,
        "manager profit share protocol profit share must be < 100%"
    )?;
    vault.profit_share = params.profit_share;
    vp.protocol_profit_share = vp_params.protocol_profit_share;

    vp.protocol = vp_params.protocol;
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

  ctx.drift_initialize_user(params.name, bump)?;
  ctx.drift_initialize_user_stats(params.name, bump)?;

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
  #[account(init,
  seeds = [b"vault", params.name.as_ref()],
  space = Vault::SIZE,
  bump,
  payer = payer)]
  pub vault: AccountLoader<'info, Vault>,

  // #[account(init,
  // seeds = [b"vault_protocol", vault.key().as_ref()],
  // space = VaultProtocol::SIZE,
  // bump,
  // payer = payer)]
  // pub vault_protocol: Option<AccountLoader<'info, VaultProtocol>>,
  
  #[account(init,
  seeds = [b"vault_token_account".as_ref(), vault.key().as_ref()],
  bump,
  payer = payer,
  token::mint = drift_spot_market_mint,
  token::authority = vault)]
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
  #[account(constraint = drift_spot_market.load() ?.market_index == params.spot_market_index)]
  pub drift_spot_market: AccountLoader<'info, SpotMarket>,
  #[account(constraint = drift_spot_market.load() ?.mint.eq(& drift_spot_market_mint.key()))]
  pub drift_spot_market_mint: Box<Account<'info, Mint>>,
  pub manager: Signer<'info>,
  pub protocol: Signer<'info>,
  #[account(mut)]
  pub payer: Signer<'info>,
  pub rent: Sysvar<'info, Rent>,
  pub system_program: Program<'info, System>,
  pub drift_program: Program<'info, Drift>,
  pub token_program: Program<'info, Token>,
}

impl<'info> InitializeUserCPI for Context<'_, '_, '_, 'info, InitializeVault<'info>> {
  fn drift_initialize_user(&self, name: [u8; 32], bump: u8) -> Result<()> {
    let vault = self.accounts.vault.load()?;
    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    drop(vault);
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

  fn drift_initialize_user_stats(&self, name: [u8; 32], bump: u8) -> Result<()> {
    let vault = self.accounts.vault.load()?;
    let signature_seeds = Vault::get_vault_signer_seeds(&name, &bump);
    drop(vault);
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
}



// #[test]
// fn borsh_option() {
//   use anchor_lang::prelude::borsh::{BorshDeserialize, BorshSerialize};
//
//   #[derive(BorshSerialize, BorshDeserialize, Debug)]
//   struct MyStruct {
//     field1: u32,
//     field2: Option<u32>,
//   }
//
//   // Serialized data with missing `field2`
//   let data = vec![1, 0, 0, 0, 1, 1, 0, 0, 0]; // Only `field1` is present (value 1)
//
//   // Deserialize
//   let result = MyStruct::try_from_slice(&data);
//
//   match result {
//     Ok(my_struct) => {
//       println!("field1: {}", my_struct.field1);
//       match my_struct.field2 {
//         Some(value) => println!("field2: {}", value),
//         None => println!("field2: None"),
//       }
//     }
//     Err(e) => println!("Error: {}", e),
//   }
// }