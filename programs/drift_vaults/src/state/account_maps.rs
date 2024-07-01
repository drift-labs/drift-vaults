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
        has_vault_protocol: bool,
    ) -> DriftResult<AccountMaps<'a>>;
}

impl<'a: 'info, 'info, T: anchor_lang::Bumps> AccountMapProvider<'a>
    for Context<'_, '_, 'a, 'info, T>
{
    fn load_maps(
        &self,
        slot: u64,
        writable_spot_market_index: Option<u16>,
        has_vault_protocol: bool,
    ) -> DriftResult<AccountMaps<'a>> {
        // if [`VaultProtocol`] exists it will be the last index in the remaining_accounts, so we need to skip it.
        let end_index = self.remaining_accounts.len() - (has_vault_protocol as usize);
        let remaining_accounts_iter = &mut self.remaining_accounts[..end_index].iter().peekable();
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
