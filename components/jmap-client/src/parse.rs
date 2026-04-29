//! Pure parsing of a JMAP session resource.
//!
//! Lives in its own module so `cargo test` on the host target exercises the
//! protocol logic directly without needing a WASM runtime. The component
//! shell in `lib.rs` is a thin adapter from this module's types to the
//! WIT-generated types.

use serde::Deserialize;
use std::collections::HashMap;

/// Narrow projection of the JMAP session resource. Mirrors the
/// `session.get` capability contract field-for-field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionData {
    pub username: String,
    pub api_url: String,
    pub download_url: String,
    pub upload_url: String,
    pub event_source_url: String,
    pub state: String,
    pub primary_account_id_mail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseErrorCode {
    MalformedJson,
    MissingField,
    WrongType,
    NoMailAccount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub code: ParseErrorCode,
    pub message: String,
}

const URN_MAIL: &str = "urn:ietf:params:jmap:mail";

#[derive(Deserialize)]
struct RawSession {
    username: Option<String>,
    #[serde(rename = "apiUrl")]
    api_url: Option<String>,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
    #[serde(rename = "uploadUrl")]
    upload_url: Option<String>,
    #[serde(rename = "eventSourceUrl")]
    event_source_url: Option<String>,
    state: Option<String>,
    #[serde(rename = "primaryAccounts")]
    primary_accounts: Option<HashMap<String, String>>,
}

pub fn parse_session(json: &str) -> Result<SessionData, ParseError> {
    let raw: RawSession = serde_json::from_str(json).map_err(|e| {
        // serde_json folds type errors into the same `Error` value; classify
        // by the error category so callers get a useful code.
        let code = match e.classify() {
            serde_json::error::Category::Data => ParseErrorCode::WrongType,
            _ => ParseErrorCode::MalformedJson,
        };
        ParseError {
            code,
            message: e.to_string(),
        }
    })?;

    let username = require(raw.username, "username")?;
    let api_url = require(raw.api_url, "apiUrl")?;
    let download_url = require(raw.download_url, "downloadUrl")?;
    let upload_url = require(raw.upload_url, "uploadUrl")?;
    let event_source_url = require(raw.event_source_url, "eventSourceUrl")?;
    let state = require(raw.state, "state")?;

    let primary_accounts = require(raw.primary_accounts, "primaryAccounts")?;
    let primary_account_id_mail =
        primary_accounts
            .get(URN_MAIL)
            .cloned()
            .ok_or_else(|| ParseError {
                code: ParseErrorCode::NoMailAccount,
                message: format!("primaryAccounts is missing {URN_MAIL}"),
            })?;

    Ok(SessionData {
        username,
        api_url,
        download_url,
        upload_url,
        event_source_url,
        state,
        primary_account_id_mail,
    })
}

fn require<T>(value: Option<T>, field: &str) -> Result<T, ParseError> {
    value.ok_or_else(|| ParseError {
        code: ParseErrorCode::MissingField,
        message: format!("missing required field: {field}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../tests/fixtures/session.json");

    #[test]
    fn parses_recorded_fixture() {
        let session = parse_session(FIXTURE).expect("fixture should parse");
        assert_eq!(session.username, "user@example.net");
        assert_eq!(session.api_url, "https://sw-mail.example.net/jmap/");
        assert_eq!(session.state, "817d3028");
        assert_eq!(session.primary_account_id_mail, "c");
        assert!(session.download_url.contains("{accountId}"));
        assert!(session.upload_url.contains("{accountId}"));
        assert!(session.event_source_url.contains("{types}"));
    }

    #[test]
    fn malformed_json_classified() {
        let err = parse_session("{not json").unwrap_err();
        assert_eq!(err.code, ParseErrorCode::MalformedJson);
    }

    #[test]
    fn missing_required_field_classified() {
        let json = r#"{
            "username": "u",
            "apiUrl": "x",
            "downloadUrl": "x",
            "uploadUrl": "x",
            "eventSourceUrl": "x",
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "c"}
        }"#;
        let err = parse_session(json).unwrap_err();
        assert_eq!(err.code, ParseErrorCode::MissingField);
        assert!(err.message.contains("state"), "{}", err.message);
    }

    #[test]
    fn wrong_type_classified() {
        let json = r#"{"username": 42}"#;
        let err = parse_session(json).unwrap_err();
        assert_eq!(err.code, ParseErrorCode::WrongType);
    }

    #[test]
    fn missing_mail_account_classified() {
        let json = r#"{
            "username": "u",
            "apiUrl": "x",
            "downloadUrl": "x",
            "uploadUrl": "x",
            "eventSourceUrl": "x",
            "state": "s",
            "primaryAccounts": {"urn:ietf:params:jmap:submission": "c"}
        }"#;
        let err = parse_session(json).unwrap_err();
        assert_eq!(err.code, ParseErrorCode::NoMailAccount);
    }

    #[test]
    fn ignores_extra_fields() {
        let json = r#"{
            "username": "u@example.net",
            "apiUrl": "x", "downloadUrl": "x", "uploadUrl": "x",
            "eventSourceUrl": "x", "state": "s",
            "primaryAccounts": {"urn:ietf:params:jmap:mail": "c"},
            "capabilities": {"urn:ietf:params:jmap:core": {}},
            "accounts": {"c": {"name": "u@example.net"}}
        }"#;
        let s = parse_session(json).expect("parses with unknown extras");
        assert_eq!(s.username, "u@example.net");
    }
}
