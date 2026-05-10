//! `iarsma:html-sanitizer` — pure HTML sanitization (D-038).
//!
//! Pure logic lives in `sanitize`; the WIT-component shell wires it
//! into the cargo-component-generated bindings. Bindings are gated on
//! `target_arch = "wasm32"` so `cargo test` on the host can exercise
//! the protocol logic without a WASM runtime — same pattern as the
//! action-log and jmap-client crates.

mod sanitize;

pub use sanitize::sanitize;

#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings {
    include!("bindings.rs");
}

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::bindings::exports::iarsma::html_sanitizer::sanitize::Guest;
    use crate::sanitize;

    pub struct Component;

    impl Guest for Component {
        fn sanitize(html: String, allow_external_images: bool) -> String {
            sanitize::sanitize(&html, allow_external_images)
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
