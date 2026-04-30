//! Pure canonicalization for the Tier-1 memory backend.
//!
//! Per D-038: the host hashes / persists the bytes this module produces.
//! Field order and the omit-whitespace JSON shape are load-bearing —
//! changing them changes the hash, which would invalidate every existing
//! entry (CT-6 schema versioning would govern any future change).

use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoryErrorCode {
    InvalidInput,
    MalformedJson,
    NotImplemented,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryError {
    pub code: MemoryErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationInput {
    pub target: String,
    pub body_json: String,
    pub identity: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub identity: String,
    pub body_json: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BehaviorSignal {
    pub identity: String,
    pub kind: String,
    pub body_json: String,
    pub observed_at_ms: u64,
}

pub fn canonicalize_annotation(input: &AnnotationInput) -> Result<Vec<u8>, MemoryError> {
    require_non_empty(&input.target, "target")?;
    require_non_empty(&input.identity, "identity")?;
    validate_json(&input.body_json)?;

    let mut out = String::with_capacity(192);
    out.push_str("{\"body_json\":");
    write_json_string(&mut out, &input.body_json);
    out.push_str(",\"created_at_ms\":");
    let _ = write!(out, "{}", input.created_at_ms);
    out.push_str(",\"identity\":");
    write_json_string(&mut out, &input.identity);
    out.push_str(",\"target\":");
    write_json_string(&mut out, &input.target);
    out.push('}');
    Ok(out.into_bytes())
}

pub fn canonicalize_profile(input: &Profile) -> Result<Vec<u8>, MemoryError> {
    require_non_empty(&input.identity, "identity")?;
    validate_json(&input.body_json)?;

    let mut out = String::with_capacity(128);
    out.push_str("{\"body_json\":");
    write_json_string(&mut out, &input.body_json);
    out.push_str(",\"identity\":");
    write_json_string(&mut out, &input.identity);
    out.push_str(",\"updated_at_ms\":");
    let _ = write!(out, "{}", input.updated_at_ms);
    out.push('}');
    Ok(out.into_bytes())
}

pub fn canonicalize_signal(input: &BehaviorSignal) -> Result<Vec<u8>, MemoryError> {
    require_non_empty(&input.identity, "identity")?;
    require_non_empty(&input.kind, "kind")?;
    validate_json(&input.body_json)?;

    let mut out = String::with_capacity(160);
    out.push_str("{\"body_json\":");
    write_json_string(&mut out, &input.body_json);
    out.push_str(",\"identity\":");
    write_json_string(&mut out, &input.identity);
    out.push_str(",\"kind\":");
    write_json_string(&mut out, &input.kind);
    out.push_str(",\"observed_at_ms\":");
    let _ = write!(out, "{}", input.observed_at_ms);
    out.push('}');
    Ok(out.into_bytes())
}

fn require_non_empty(value: &str, field: &str) -> Result<(), MemoryError> {
    if value.is_empty() {
        return Err(MemoryError {
            code: MemoryErrorCode::InvalidInput,
            message: format!("required field is empty: {field}"),
        });
    }
    Ok(())
}

fn validate_json(s: &str) -> Result<(), MemoryError> {
    serde_json::from_str::<serde_json::Value>(s).map_err(|e| MemoryError {
        code: MemoryErrorCode::MalformedJson,
        message: format!("body_json is not valid JSON: {e}"),
    })?;
    Ok(())
}

/// JSON-encode a string per RFC 8259 — quoted, with the seven required
/// control-char escapes. Identical helper as the action-log component
/// to avoid pulling a serializer dep at this surface.
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

    #[test]
    fn annotation_round_trip_is_deterministic_and_sorted() {
        let input = AnnotationInput {
            target: "thread:abc".into(),
            body_json: "{\"note\":\"keep an eye on this\"}".into(),
            identity: "user@example.net".into(),
            created_at_ms: 1700000000000,
        };
        let a = canonicalize_annotation(&input).unwrap();
        let b = canonicalize_annotation(&input).unwrap();
        assert_eq!(a, b);

        let s = std::str::from_utf8(&a).unwrap();
        assert_eq!(
            s,
            "{\
\"body_json\":\"{\\\"note\\\":\\\"keep an eye on this\\\"}\",\
\"created_at_ms\":1700000000000,\
\"identity\":\"user@example.net\",\
\"target\":\"thread:abc\"\
}"
        );
    }

    #[test]
    fn annotation_rejects_empty_target() {
        let input = AnnotationInput {
            target: "".into(),
            body_json: "{}".into(),
            identity: "u".into(),
            created_at_ms: 1,
        };
        let err = canonicalize_annotation(&input).unwrap_err();
        assert_eq!(err.code, MemoryErrorCode::InvalidInput);
        assert!(err.message.contains("target"), "{}", err.message);
    }

    #[test]
    fn annotation_rejects_malformed_json_body() {
        let input = AnnotationInput {
            target: "thread:abc".into(),
            body_json: "{not json".into(),
            identity: "u".into(),
            created_at_ms: 1,
        };
        let err = canonicalize_annotation(&input).unwrap_err();
        assert_eq!(err.code, MemoryErrorCode::MalformedJson);
    }

    #[test]
    fn profile_canonical_form_is_sorted() {
        let input = Profile {
            identity: "u@example.net".into(),
            body_json: "{\"signature\":\"hi\"}".into(),
            updated_at_ms: 42,
        };
        let s = String::from_utf8(canonicalize_profile(&input).unwrap()).unwrap();
        assert_eq!(
            s,
            "{\
\"body_json\":\"{\\\"signature\\\":\\\"hi\\\"}\",\
\"identity\":\"u@example.net\",\
\"updated_at_ms\":42\
}"
        );
    }

    #[test]
    fn profile_rejects_empty_identity() {
        let input = Profile {
            identity: "".into(),
            body_json: "{}".into(),
            updated_at_ms: 1,
        };
        let err = canonicalize_profile(&input).unwrap_err();
        assert_eq!(err.code, MemoryErrorCode::InvalidInput);
    }

    #[test]
    fn signal_canonical_form_is_sorted() {
        let input = BehaviorSignal {
            identity: "u".into(),
            kind: "compose-style".into(),
            body_json: "{\"avg_words\":42}".into(),
            observed_at_ms: 1700000000000,
        };
        let s = String::from_utf8(canonicalize_signal(&input).unwrap()).unwrap();
        assert!(s.starts_with("{\"body_json\":"), "{s}");
        assert!(s.contains("\"identity\":\"u\""), "{s}");
        assert!(s.contains("\"kind\":\"compose-style\""), "{s}");
        assert!(s.ends_with("\"observed_at_ms\":1700000000000}"), "{s}");
    }

    #[test]
    fn signal_rejects_empty_kind() {
        let input = BehaviorSignal {
            identity: "u".into(),
            kind: "".into(),
            body_json: "{}".into(),
            observed_at_ms: 1,
        };
        let err = canonicalize_signal(&input).unwrap_err();
        assert_eq!(err.code, MemoryErrorCode::InvalidInput);
    }

    #[test]
    fn each_record_changes_when_any_field_changes() {
        let base = AnnotationInput {
            target: "thread:abc".into(),
            body_json: "{}".into(),
            identity: "u".into(),
            created_at_ms: 1,
        };
        let baseline = canonicalize_annotation(&base).unwrap();

        let mut a = base.clone();
        a.target = "thread:xyz".into();
        assert_ne!(baseline, canonicalize_annotation(&a).unwrap());

        let mut b = base.clone();
        b.body_json = "{\"x\":1}".into();
        assert_ne!(baseline, canonicalize_annotation(&b).unwrap());

        let mut c = base.clone();
        c.identity = "other".into();
        assert_ne!(baseline, canonicalize_annotation(&c).unwrap());

        let mut d = base.clone();
        d.created_at_ms = 2;
        assert_ne!(baseline, canonicalize_annotation(&d).unwrap());
    }
}
