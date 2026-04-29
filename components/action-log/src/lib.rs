//! `iarsma:action-log` — pure chain logic for the tamper-evident action log.
//!
//! SHA-384 (D-027) and persistence live in the host (Web Crypto / Node Web
//! Crypto, IndexedDB or equivalent). This component owns the protocol —
//! canonical byte representation per entry and chain-link integrity
//! verification. See `canonical.rs`.

mod canonical;

pub use canonical::{canonicalize, verify_links, ChainError, Entry, EntryData};

#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings;

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::bindings::exports::iarsma::action_log::chain::{
        ChainError as WitChainError, Entry as WitEntry, EntryData as WitEntryData, Guest,
    };
    use crate::canonical;

    pub struct Component;

    impl Guest for Component {
        fn canonicalize(seq: u64, data: WitEntryData, prev_hash_hex: String) -> Vec<u8> {
            canonical::canonicalize(seq, &to_native(&data), &prev_hash_hex)
        }

        fn verify_links(entries: Vec<WitEntry>) -> Result<(), WitChainError> {
            let native: Vec<canonical::Entry> = entries
                .iter()
                .map(|e| canonical::Entry {
                    seq: e.seq,
                    data: to_native(&e.data),
                    prev_hash_hex: e.prev_hash_hex.clone(),
                    hash_hex: e.hash_hex.clone(),
                })
                .collect();
            canonical::verify_links(&native).map_err(|e| WitChainError {
                seq: e.seq,
                message: e.message,
            })
        }
    }

    fn to_native(d: &WitEntryData) -> canonical::EntryData {
        canonical::EntryData {
            timestamp_ms: d.timestamp_ms,
            identity: d.identity.clone(),
            action: d.action.clone(),
            params_json: d.params_json.clone(),
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
