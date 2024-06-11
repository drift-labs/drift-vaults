use anchor_lang::prelude::Context;
use drift::error::DriftResult;
use drift::instructions::optional_accounts::{load_maps, AccountMaps};
use drift::state::spot_market_map::get_writable_spot_market_set;
use std::collections::BTreeSet;

pub trait AccountMapProvider<'a> {
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market: Option<u16>,
    ) -> DriftResult<AccountMaps<'a>>;
}

impl<'a: 'info, 'info, T: anchor_lang::Bumps> AccountMapProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market_index: Option<u16>,
    ) -> DriftResult<AccountMaps<'a>> {
        let remaining_accounts_iter = &mut self.remaining_accounts.iter().peekable();
        load_maps(
            remaining_accounts_iter,
            &BTreeSet::new(),
            &writable_spot_market_index
                .map(get_writable_spot_market_set)
                .unwrap_or_default(),
            slot,
            None,
        )
    }
}
