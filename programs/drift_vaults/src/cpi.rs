use anchor_lang::prelude::*;

pub trait InitializeUserCPI {
    fn drift_initialize_user(&self, name: [u8; 32], bump: u8) -> Result<()>;

    fn drift_initialize_user_stats(&self, name: [u8; 32], bump: u8) -> Result<()>;
}

pub trait DepositCPI {
    fn drift_deposit(&self, amount: u64) -> Result<()>;
}

pub trait WithdrawCPI {
    fn drift_withdraw(&self, amount: u64) -> Result<()>;
}

pub trait UpdateUserDelegateCPI {
    fn drift_update_user_delegate(&self, delegate: Pubkey) -> Result<()>;
}

pub trait UpdateUserReduceOnlyCPI {
    fn drift_update_user_reduce_only(&self, reduce_only: bool) -> Result<()>;
}

pub trait UpdateUserMarginTradingEnabledCPI {
    fn drift_update_user_margin_trading_enabled(&self, enabled: bool) -> Result<()>;
}

pub trait TokenTransferCPI {
    fn token_transfer(&self, amount: u64) -> Result<()>;
}

pub trait InitializeInsuranceFundStakeCPI {
    fn drift_initialize_insurance_fund_stake(&self, market_index: u16) -> Result<()>;
}

pub trait InitializeCompetitorCPI {
    fn drift_competition_initialize_competitor(&self) -> Result<()>;
}
