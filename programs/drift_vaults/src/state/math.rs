use anchor_lang::prelude::*;
use drift::math::safe_math::SafeMath;

pub fn token_a_to_token_b(
    token_a_amount: u64,
    token_a_price: i64,
    token_a_decimals: u32,
    token_b_price: i64,
    token_b_decimals: u32,
) -> Result<u64> {
    let quote_amount: u128 = (token_a_amount as u128).safe_mul(token_a_price as u128)?;
    let mut token_b_amount: u128 = quote_amount.safe_div(token_b_price as u128)?;

    if token_a_decimals < token_b_decimals {
        let decimal_diff = token_b_decimals - token_a_decimals;
        token_b_amount = token_b_amount.safe_mul(10u128.pow(decimal_diff as u32))?;
    } else if token_a_decimals > token_b_decimals {
        let decimal_diff = token_a_decimals - token_b_decimals;
        token_b_amount = token_b_amount.safe_div(10u128.pow(decimal_diff as u32))?;
    }

    Ok(token_b_amount as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_token_a_to_token_b_same_decimals() {
        // Test case: Same decimals (6)
        let result = token_a_to_token_b(
            1_000_000, // 1 tokenA
            1_000_000, // $1 price
            6,         // 6 decimals
            1_000_000, // $1 price
            6,         // 6 decimals
        )
        .unwrap();
        assert_eq!(result, 1_000_000); // Should get 1 tokenB
    }

    #[test]
    fn test_convert_token_a_to_token_b_different_decimals() {
        // Test case: TokenA (6 decimals) to TokenB (9 decimals)
        let result = token_a_to_token_b(
            1_000_000, // 1 tokenA
            1_000_000, // $1 price
            6,         // 6 decimals
            1_000_000, // $1 price
            9,         // 9 decimals
        )
        .unwrap();
        assert_eq!(result, 1_000_000_000); // Should get 1 tokenB (with 9 decimals)
    }

    #[test]
    fn test_convert_token_a_to_token_b_different_decimals_2() {
        // Test case: TokenA (9 decimals) to TokenB (6 decimals)
        let result = token_a_to_token_b(
            1_000_000_000, // 1 tokenA
            1_000_000,     // $1 price
            9,             // 9 decimals
            1_000_000,     // $1 price
            6,             // 6 decimals
        )
        .unwrap();
        assert_eq!(result, 1_000_000); // Should get 1 tokenB (with 6 decimals)
    }

    #[test]
    fn test_convert_token_a_to_token_b_different_prices() {
        // Test case: Different prices
        let result = token_a_to_token_b(
            1_000_000, // 1 tokenA
            2_000_000, // $2 price
            6,         // 6 decimals
            1_000_000, // $1 price
            6,         // 6 decimals
        )
        .unwrap();
        assert_eq!(result, 2_000_000); // Should get 2 tokenB
    }

    #[test]
    fn test_convert_token_a_to_token_b_large_numbers() {
        // Test case: Large numbers with different decimals
        let result = token_a_to_token_b(
            1_000_000_000, // 1000 tokenA
            2_000_000,     // $2 price
            6,             // 6 decimals
            1_000_000,     // $1 price
            9,             // 9 decimals
        )
        .unwrap();
        assert_eq!(result, 2_000_000_000_000); // Should get 2000 tokenB (with 9 decimals)
    }

    #[test]
    fn test_convert_token_a_to_token_b_large_numbers_2() {
        // Test case: Large numbers with different decimals
        let result = token_a_to_token_b(
            1_000_000_000_000, // 1000 tokenA
            2_000_000,         // $2 price
            9,                 // 9 decimals
            1_000_000,         // $1 price
            6,                 // 6 decimals
        )
        .unwrap();
        assert_eq!(result, 2_000_000_000); // Should get 2000 tokenB (with 6 decimals)
    }
}
