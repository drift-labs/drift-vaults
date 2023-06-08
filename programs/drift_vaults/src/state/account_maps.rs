use anchor_lang::prelude::Context;
use drift::error::DriftResult;
use drift::instructions::optional_accounts::{load_maps, AccountMaps};
use drift::state::perp_market_map::MarketSet;
use drift::state::spot_market_map::get_writable_spot_market_set;

pub trait AccountMapProvider<'a> {
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market: Option<u16>,
    ) -> DriftResult<AccountMaps<'a>>;
}

impl<'info, T> AccountMapProvider<'info> for Context<'_, '_, '_, 'info, T> {
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market_index: Option<u16>,
    ) -> DriftResult<AccountMaps<'info>> {
        let remaining_accounts_iter = &mut self.remaining_accounts.iter().peekable();
        load_maps(
            remaining_accounts_iter,
            &MarketSet::new(),
            &writable_spot_market_index
                .map(get_writable_spot_market_set)
                .unwrap_or_default(),
            slot,
            None,
        )
    }
}
