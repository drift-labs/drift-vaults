extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput, Fields};

#[allow(clippy::panic)]
#[proc_macro_attribute]
pub fn assert_no_hidden_padding(_: TokenStream, input: TokenStream) -> TokenStream {
    let derive_input = parse_macro_input!(input as DeriveInput);
    let struct_name = &derive_input.ident;

    let expanded = match &derive_input.data {
        Data::Struct(data_struct) => match &data_struct.fields {
            Fields::Named(fields) => {
                let field_sizes = fields.named.iter().map(|field| &field.ty);
                let sizes_sum = quote! { #(std::mem::size_of::<#field_sizes>())+* };

                quote! {
                    const STRUCT_SIZE: usize = std::mem::size_of::<#struct_name>();
                    const FIELD_SIZES: usize = #sizes_sum;

                    const_assert_eq!(STRUCT_SIZE, FIELD_SIZES);
                }
            }
            Fields::Unnamed(fields) => {
                let field_types = fields.unnamed.iter().map(|field| &field.ty);
                let sizes_sum = quote! { #(std::mem::size_of::<#field_types>())+* };

                quote! {
                    const STRUCT_SIZE: usize = std::mem::size_of::<#struct_name>();
                    const FIELD_SIZES: usize = #sizes_sum;

                    const_assert_eq!(STRUCT_SIZE, FIELD_SIZES);
                }
            }
            Fields::Unit => {
                panic!("assert_no_padding attribute cannot be used on unit structs");
            }
        },
        _ => {
            panic!("assert_no_padding attribute can only be used on structs");
        }
    };

    let output = quote! {
        #derive_input
        #expanded
    };
    output.into()
}
