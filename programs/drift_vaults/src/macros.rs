use anchor_lang::prelude::*;

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
macro_rules! safe_increment {
    ($struct:expr, $value:expr) => {{
        $struct = $struct.checked_add($value).ok_or_else(math_error!())?
    }};
}

#[macro_export]
macro_rules! safe_decrement {
    ($struct:expr, $value:expr) => {{
        $struct = $struct.checked_sub($value).ok_or_else(math_error!())?
    }};
}
