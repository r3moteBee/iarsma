//! `iarsma:jmap-client` — thin JMAP client wrapper, parse-only (D-038).
//!
//! Pure parsing logic lives in `parse`; the WIT-component shell wires it
//! into the cargo-component-generated bindings. Bindings are gated on
//! `target_arch = "wasm32"` so `cargo test` on the host can exercise the
//! protocol logic without a WASM runtime.

mod parse;

// Re-export the host-target API. Useful for any rlib consumer (the
// component itself uses these via the `component` module below) and
// suppresses dead-code warnings on non-wasm builds.
pub use parse::{parse_session, ParseError, ParseErrorCode, SessionData};

#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings;

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::bindings::exports::iarsma::jmap_client::session::{
        Guest, ParseError, ParseErrorCode, Session,
    };
    use crate::parse;

    pub struct Component;

    impl Guest for Component {
        fn parse_session(json: String) -> Result<Session, ParseError> {
            parse::parse_session(&json)
                .map(|s| Session {
                    username: s.username,
                    api_url: s.api_url,
                    download_url: s.download_url,
                    upload_url: s.upload_url,
                    event_source_url: s.event_source_url,
                    state: s.state,
                    primary_account_id_mail: s.primary_account_id_mail,
                })
                .map_err(|e| ParseError {
                    code: match e.code {
                        parse::ParseErrorCode::MalformedJson => ParseErrorCode::MalformedJson,
                        parse::ParseErrorCode::MissingField => ParseErrorCode::MissingField,
                        parse::ParseErrorCode::WrongType => ParseErrorCode::WrongType,
                        parse::ParseErrorCode::NoMailAccount => ParseErrorCode::NoMailAccount,
                    },
                    message: e.message,
                })
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
