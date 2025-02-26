pub const TIME_FOR_LIQUIDATION: i64 = ONE_HOUR;

// TIME
pub const ONE_HOUR: i64 = 60 * 60;
pub const ONE_DAY: i64 = ONE_HOUR * 24;

pub mod permissioned_liquidator {
    use anchor_lang::prelude::declare_id;
    declare_id!("4wbNjWbj3kPDbyKnSq8SXVEtAJw4uzE8mJ2QwuK1BCYZ");
}

pub const FUEL_SHARE_PRECISION: u128 = 1_000_000_000_000_000_000; // expo -18
pub const MAGIC_FUEL_START_TS: u32 = 123; // some arbitrary timestamp to identify VaultDepositors created after fuel distribution started.
