pub const TIME_FOR_LIQUIDATION: i64 = ONE_HOUR;

// TIME
pub const ONE_HOUR: i64 = 60 * 60;
pub const ONE_DAY: i64 = ONE_HOUR * 24;

pub mod permissioned_liquidator {
    use anchor_lang::prelude::declare_id;
    declare_id!("4wbNjWbj3kPDbyKnSq8SXVEtAJw4uzE8mJ2QwuK1BCYZ");
}
