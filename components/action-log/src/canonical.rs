//! Canonicalization + chain link verification — the pure protocol logic.
//!
//! Per D-038 the WASM component does not compute SHA-384; the host (Web
//! Crypto / Node Web Crypto, per D-027) hashes the bytes this module
//! produces. Keeping hashing host-side means the component has no I/O,
//! `cargo test` runs the protocol logic on the host target, and the
//! algorithm choice from D-027 is honored without a WASM-side crypto
//! dependency.

use serde::Serialize;
use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EntryData {
    pub timestamp_ms: u64,
    pub identity: String,
    pub action: String,
    pub params_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub seq: u64,
    pub data: EntryData,
    pub prev_hash_hex: String,
    pub hash_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainError {
    pub seq: u64,
    pub message: String,
}

/// Produce the canonical bytes the host should SHA-384.
///
/// Format: a JSON object with sorted, fixed-order keys and no whitespace.
/// Field order is locked here — changing it changes the hash, which would
/// invalidate every existing log entry. Adding a new field requires a
/// schema-version migration (CT-6).
pub fn canonicalize(seq: u64, data: &EntryData, prev_hash_hex: &str) -> Vec<u8> {
    // Hand-rolled to guarantee key order without pulling in serde_jcs or
    // BTreeMap — six fields is small and the format is load-bearing.
    let mut out = String::with_capacity(256);
    out.push_str("{\"action\":");
    write_json_string(&mut out, &data.action);
    out.push_str(",\"identity\":");
    write_json_string(&mut out, &data.identity);
    out.push_str(",\"params_json\":");
    write_json_string(&mut out, &data.params_json);
    out.push_str(",\"prev_hash_hex\":");
    write_json_string(&mut out, prev_hash_hex);
    out.push_str(",\"seq\":");
    let _ = write!(out, "{seq}");
    out.push_str(",\"timestamp_ms\":");
    let _ = write!(out, "{}", data.timestamp_ms);
    out.push('}');
    out.into_bytes()
}

/// Verify chain link integrity: sequence numbers are 0..N monotonic, the
/// genesis entry has empty `prev_hash_hex`, and every other entry's
/// `prev_hash_hex` equals the prior entry's `hash_hex`. Does not recompute
/// SHA-384 — payload-tamper detection is the host's job (re-canonicalize +
/// re-hash + compare).
pub fn verify_links(entries: &[Entry]) -> Result<(), ChainError> {
    for (i, entry) in entries.iter().enumerate() {
        let expected_seq = i as u64;
        if entry.seq != expected_seq {
            return Err(ChainError {
                seq: entry.seq,
                message: format!(
                    "out-of-order seq: expected {expected_seq}, got {}",
                    entry.seq,
                ),
            });
        }
        if i == 0 {
            if !entry.prev_hash_hex.is_empty() {
                return Err(ChainError {
                    seq: entry.seq,
                    message: "genesis entry must have empty prev_hash_hex".into(),
                });
            }
        } else {
            let prior = &entries[i - 1];
            if entry.prev_hash_hex != prior.hash_hex {
                return Err(ChainError {
                    seq: entry.seq,
                    message: format!(
                        "broken link: prev_hash_hex {:?} does not match prior entry's hash_hex {:?}",
                        entry.prev_hash_hex, prior.hash_hex,
                    ),
                });
            }
        }
        if entry.hash_hex.is_empty() {
            return Err(ChainError {
                seq: entry.seq,
                message: "hash_hex must be non-empty".into(),
            });
        }
    }
    Ok(())
}

/// JSON-encode a string per RFC 8259: surrounding quotes, escape `"` and
/// `\\`, and the seven required control-character escapes. Other code
/// points pass through as UTF-8. Sufficient for the canonical form because
/// inputs are sanitized at the host boundary before reaching here.
fn write_json_string(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(ts: u64, action: &str) -> EntryData {
        EntryData {
            timestamp_ms: ts,
            identity: "user@example.net".into(),
            action: action.into(),
            params_json: "{}".into(),
        }
    }

    #[test]
    fn canonicalize_is_deterministic() {
        let d = data(1700000000000, "session.get");
        let a = canonicalize(0, &d, "");
        let b = canonicalize(0, &d, "");
        assert_eq!(a, b);
    }

    #[test]
    fn canonical_keys_are_sorted_and_unspaced() {
        let d = data(42, "session.get");
        let bytes = canonicalize(7, &d, "abc");
        let s = std::str::from_utf8(&bytes).unwrap();
        assert_eq!(
            s,
            r#"{"action":"session.get","identity":"user@example.net","params_json":"{}","prev_hash_hex":"abc","seq":7,"timestamp_ms":42}"#
        );
    }

    #[test]
    fn canonicalize_escapes_specials() {
        let d = EntryData {
            timestamp_ms: 0,
            identity: "u".into(),
            action: "a\"b\\c\nd\te".into(),
            params_json: "{}".into(),
        };
        let s = String::from_utf8(canonicalize(0, &d, "")).unwrap();
        assert!(s.contains(r#""action":"a\"b\\c\nd\te""#), "got {s}");
    }

    #[test]
    fn canonicalize_changes_when_any_input_changes() {
        let d1 = data(1, "session.get");
        let d2 = data(2, "session.get");
        let d3 = data(1, "mailbox.list");
        let mut d4 = data(1, "session.get");
        d4.params_json = "{\"x\":1}".into();
        let mut d5 = data(1, "session.get");
        d5.identity = "other@example.net".into();

        let base = canonicalize(0, &d1, "");
        assert_ne!(base, canonicalize(0, &d2, ""));
        assert_ne!(base, canonicalize(0, &d3, ""));
        assert_ne!(base, canonicalize(0, &d4, ""));
        assert_ne!(base, canonicalize(0, &d5, ""));
        assert_ne!(base, canonicalize(1, &d1, ""));
        assert_ne!(base, canonicalize(0, &d1, "abc"));
    }

    fn entry(seq: u64, prev: &str, hash: &str) -> Entry {
        Entry {
            seq,
            data: data(seq, "session.get"),
            prev_hash_hex: prev.into(),
            hash_hex: hash.into(),
        }
    }

    #[test]
    fn empty_chain_is_valid() {
        verify_links(&[]).unwrap();
    }

    #[test]
    fn genesis_only_chain_is_valid() {
        verify_links(&[entry(0, "", "h0")]).unwrap();
    }

    #[test]
    fn linked_chain_is_valid() {
        verify_links(&[
            entry(0, "", "h0"),
            entry(1, "h0", "h1"),
            entry(2, "h1", "h2"),
        ])
        .unwrap();
    }

    #[test]
    fn rejects_genesis_with_prev_hash() {
        let err = verify_links(&[entry(0, "wrong", "h0")]).unwrap_err();
        assert_eq!(err.seq, 0);
        assert!(err.message.contains("genesis"), "{}", err.message);
    }

    #[test]
    fn rejects_broken_link() {
        let err = verify_links(&[
            entry(0, "", "h0"),
            entry(1, "WRONG", "h1"),
        ])
        .unwrap_err();
        assert_eq!(err.seq, 1);
        assert!(err.message.contains("broken link"), "{}", err.message);
    }

    #[test]
    fn rejects_seq_skip() {
        let err = verify_links(&[
            entry(0, "", "h0"),
            entry(2, "h0", "h2"),
        ])
        .unwrap_err();
        assert_eq!(err.seq, 2);
        assert!(err.message.contains("out-of-order"), "{}", err.message);
    }

    #[test]
    fn rejects_empty_hash() {
        let err = verify_links(&[entry(0, "", "")]).unwrap_err();
        assert_eq!(err.seq, 0);
        assert!(err.message.contains("hash_hex"), "{}", err.message);
    }
}
