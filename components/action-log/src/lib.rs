//! `iarsma:action-log` — pure chain logic for the tamper-evident action log.
//!
//! SHA-384 (D-027) and persistence live in the host (Web Crypto / Node Web
//! Crypto, IndexedDB or equivalent). This component owns the protocol —
//! canonical byte representation per entry and chain-link integrity
//! verification. See `canonical.rs`.

mod canonical;

pub use canonical::{
    canonicalize, verify_links, CallMode, CallerClass, ChainError, Entry, EntryData, ProvenanceData,
};

// `include!` instead of `mod bindings;` so rustfmt doesn't recurse into
// the cargo-component-generated file. See the matching comment in
// jmap-client/src/lib.rs.
#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings {
    include!("bindings.rs");
}

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::bindings::exports::iarsma::action_log::chain::{
        CallMode as WitCallMode, CallerClass as WitCallerClass, ChainError as WitChainError,
        Entry as WitEntry, EntryData as WitEntryData, Guest, ProvenanceData as WitProvenanceData,
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
            schema_version: d.schema_version,
            timestamp_ms: d.timestamp_ms,
            caller_class: caller_class_to_native(d.caller_class),
            identity: d.identity.clone(),
            action: d.action.clone(),
            mode: d.mode.map(call_mode_to_native),
            params_json: d.params_json.clone(),
            provenance: d.provenance.as_ref().map(provenance_to_native),
        }
    }

    fn caller_class_to_native(c: WitCallerClass) -> canonical::CallerClass {
        match c {
            WitCallerClass::Ui => canonical::CallerClass::Ui,
            WitCallerClass::Mcp => canonical::CallerClass::Mcp,
            WitCallerClass::Library => canonical::CallerClass::Library,
        }
    }

    fn call_mode_to_native(m: WitCallMode) -> canonical::CallMode {
        match m {
            WitCallMode::Preview => canonical::CallMode::Preview,
            WitCallMode::Commit => canonical::CallMode::Commit,
        }
    }

    fn provenance_to_native(p: &WitProvenanceData) -> canonical::ProvenanceData {
        canonical::ProvenanceData {
            affected_json: p.affected_json.clone(),
            preview_hash_hex: p.preview_hash_hex.clone(),
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
