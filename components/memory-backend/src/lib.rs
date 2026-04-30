//! `iarsma:memory-backend` — Tier-1 memory substrate scaffold (D-030).
//!
//! Pure canonicalization lives in `canonical`. The component shell wires
//! it to cargo-component-generated bindings on the wasm32 target.
//! Persistence (SQLite-via-OPFS, Tauri FS, OB1 adapter) lives in the
//! host (D-038). Phase 0 lands the contract + scaffold; per the
//! implementation plan, "Empty implementations OK; the seam exists."

mod canonical;

pub use canonical::{
    canonicalize_annotation, canonicalize_profile, canonicalize_signal, AnnotationInput,
    BehaviorSignal, MemoryError, MemoryErrorCode, Profile,
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
    use crate::bindings::exports::iarsma::memory_backend::store::{
        AnnotationInput as WitAnnotationInput, BehaviorSignal as WitBehaviorSignal, Guest,
        MemoryError as WitMemoryError, MemoryErrorCode as WitMemoryErrorCode,
        Profile as WitProfile,
    };
    use crate::canonical;

    pub struct Component;

    impl Guest for Component {
        fn canonicalize_annotation(input: WitAnnotationInput) -> Result<Vec<u8>, WitMemoryError> {
            canonical::canonicalize_annotation(&canonical::AnnotationInput {
                target: input.target,
                body_json: input.body_json,
                identity: input.identity,
                created_at_ms: input.created_at_ms,
            })
            .map_err(to_wit_error)
        }

        fn canonicalize_profile(input: WitProfile) -> Result<Vec<u8>, WitMemoryError> {
            canonical::canonicalize_profile(&canonical::Profile {
                identity: input.identity,
                body_json: input.body_json,
                updated_at_ms: input.updated_at_ms,
            })
            .map_err(to_wit_error)
        }

        fn canonicalize_signal(input: WitBehaviorSignal) -> Result<Vec<u8>, WitMemoryError> {
            canonical::canonicalize_signal(&canonical::BehaviorSignal {
                identity: input.identity,
                kind: input.kind,
                body_json: input.body_json,
                observed_at_ms: input.observed_at_ms,
            })
            .map_err(to_wit_error)
        }
    }

    fn to_wit_error(e: canonical::MemoryError) -> WitMemoryError {
        WitMemoryError {
            code: match e.code {
                canonical::MemoryErrorCode::InvalidInput => WitMemoryErrorCode::InvalidInput,
                canonical::MemoryErrorCode::MalformedJson => WitMemoryErrorCode::MalformedJson,
                canonical::MemoryErrorCode::NotImplemented => WitMemoryErrorCode::NotImplemented,
            },
            message: e.message,
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
