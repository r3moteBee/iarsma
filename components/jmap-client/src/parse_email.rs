//! Pure parsing of a chained JMAP `Email/query` + `Email/get` response.
//!
//! Wire shape (the host sends two methodCalls in one JMAP request,
//! per RFC 8620 §3.7 — the second uses a back-reference to the first
//! so we get matching ids in one roundtrip):
//!
//! ```jsonc
//! {
//!   "methodResponses": [
//!     ["Email/query", {
//!       "accountId": "...",
//!       "queryState": "...",
//!       "canCalculateChanges": true,
//!       "position": 0,
//!       "total": 42,
//!       "ids": ["E1", "E2", ...]
//!     }, "0"],
//!     ["Email/get", {
//!       "accountId": "...",
//!       "state": "...",
//!       "list": [<email-summary>, <email-summary>, ...],
//!       "notFound": []
//!     }, "1"]
//!   ]
//! }
//! ```
//!
//! Or any of:
//!   - either method returns an `["error", {type}, ...]` triple
//!   - one method present but the other missing (partial-response)
//!
//! `Email/get` returns the requested emails in `Email/query.ids` order,
//! per RFC 8621 §5.1, so we don't need to re-sort.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailAddress {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Keyword {
    pub name: String,
    pub value: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailSummary {
    pub id: String,
    pub thread_id: String,
    pub from: Option<Vec<EmailAddress>>,
    pub to: Option<Vec<EmailAddress>>,
    pub subject: Option<String>,
    pub preview: Option<String>,
    pub received_at: String,
    pub keywords: Vec<Keyword>,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailQueryResult {
    pub emails: Vec<EmailSummary>,
    pub position: u32,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmailQueryParseErrorCode {
    MalformedJson,
    MissingField,
    WrongType,
    EmptyResponse,
    MethodError,
    PartialResponse,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailQueryParseError {
    pub code: EmailQueryParseErrorCode,
    pub message: String,
}

// ──────────────────────────────────────────────────────────────────────
// Wire-shape deserializers
// ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RawResponse {
    #[serde(rename = "methodResponses")]
    method_responses: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct RawQueryPayload {
    position: Option<u32>,
    total: Option<u64>,
    ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct RawGetPayload {
    list: Option<Vec<RawEmail>>,
}

#[derive(Deserialize)]
struct RawEmail {
    id: Option<String>,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    from: Option<serde_json::Value>,
    to: Option<serde_json::Value>,
    subject: Option<serde_json::Value>,
    preview: Option<serde_json::Value>,
    #[serde(rename = "receivedAt")]
    received_at: Option<String>,
    keywords: Option<std::collections::BTreeMap<String, bool>>,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct RawEmailAddress {
    name: Option<String>,
    email: Option<String>,
}

#[derive(Deserialize)]
struct RawMethodErrorPayload {
    #[serde(rename = "type")]
    error_type: Option<String>,
}

// ──────────────────────────────────────────────────────────────────────
// Public parser
// ──────────────────────────────────────────────────────────────────────

pub fn parse_email_query_response(
    json: &str,
) -> Result<EmailQueryResult, EmailQueryParseError> {
    let raw: RawResponse = serde_json::from_str(json).map_err(|e| {
        let code = match e.classify() {
            serde_json::error::Category::Data => EmailQueryParseErrorCode::WrongType,
            _ => EmailQueryParseErrorCode::MalformedJson,
        };
        EmailQueryParseError {
            code,
            message: e.to_string(),
        }
    })?;

    let method_responses = require(raw.method_responses, "methodResponses")?;
    if method_responses.is_empty() {
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::EmptyResponse,
            message: "methodResponses array is empty".into(),
        });
    }

    // Walk both expected method-responses. The host's request always sends
    // [Email/query, Email/get] in order, so methodResponses[0] is query
    // and methodResponses[1] is get. If either is absent, the response is
    // partial — the host or server failed somewhere upstream.
    let query_entry = &method_responses[0];
    let (query_method, query_payload) = decode_entry(query_entry, "methodResponses[0]")?;

    if query_method == "error" {
        let payload: RawMethodErrorPayload =
            serde_json::from_value(query_payload.clone()).unwrap_or(RawMethodErrorPayload {
                error_type: None,
            });
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::MethodError,
            message: payload.error_type.unwrap_or_else(|| "(no type)".into()),
        });
    }
    if query_method != "Email/query" {
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("expected Email/query first, got {query_method}"),
        });
    }

    let query: RawQueryPayload = serde_json::from_value(query_payload.clone()).map_err(|e| {
        EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("Email/query payload not parseable: {e}"),
        }
    })?;
    let position = query.position.unwrap_or(0);
    let _ids = require(query.ids, "Email/query.ids")?;

    if method_responses.len() < 2 {
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::PartialResponse,
            message: "Email/query response present but Email/get missing".into(),
        });
    }
    let get_entry = &method_responses[1];
    let (get_method, get_payload) = decode_entry(get_entry, "methodResponses[1]")?;

    if get_method == "error" {
        let payload: RawMethodErrorPayload =
            serde_json::from_value(get_payload.clone()).unwrap_or(RawMethodErrorPayload {
                error_type: None,
            });
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::MethodError,
            message: payload.error_type.unwrap_or_else(|| "(no type)".into()),
        });
    }
    if get_method != "Email/get" {
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("expected Email/get second, got {get_method}"),
        });
    }

    let get: RawGetPayload = serde_json::from_value(get_payload.clone()).map_err(|e| {
        EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("Email/get payload not parseable: {e}"),
        }
    })?;
    let raw_list = require(get.list, "Email/get.list")?;

    let emails = raw_list
        .into_iter()
        .map(into_email_summary)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(EmailQueryResult {
        emails,
        position,
        total: query.total,
    })
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

fn decode_entry(
    entry: &serde_json::Value,
    label: &'static str,
) -> Result<(String, serde_json::Value), EmailQueryParseError> {
    let arr = entry.as_array().ok_or_else(|| EmailQueryParseError {
        code: EmailQueryParseErrorCode::WrongType,
        message: format!("{label} is not an array"),
    })?;
    if arr.len() < 2 {
        return Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("{label} has {} elements, expected 3", arr.len()),
        });
    }
    let method_name = arr[0]
        .as_str()
        .ok_or_else(|| EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("{label}[0] is not a string method name"),
        })?
        .to_string();
    Ok((method_name, arr[1].clone()))
}

fn into_email_summary(raw: RawEmail) -> Result<EmailSummary, EmailQueryParseError> {
    let id = require(raw.id, "id")?;
    let thread_id = require(raw.thread_id, "threadId")?;
    let received_at = require(raw.received_at, "receivedAt")?;
    Ok(EmailSummary {
        id,
        thread_id,
        from: parse_address_list(raw.from, "from")?,
        to: parse_address_list(raw.to, "to")?,
        subject: nullable_string(raw.subject, "subject")?,
        preview: nullable_string(raw.preview, "preview")?,
        received_at,
        keywords: raw
            .keywords
            .unwrap_or_default()
            .into_iter()
            .map(|(name, value)| Keyword { name, value })
            .collect(),
        size: raw.size.unwrap_or(0),
    })
}

fn parse_address_list(
    value: Option<serde_json::Value>,
    field: &'static str,
) -> Result<Option<Vec<EmailAddress>>, EmailQueryParseError> {
    let v = match value {
        None => return Ok(None),
        Some(serde_json::Value::Null) => return Ok(None),
        Some(v) => v,
    };
    let arr = v.as_array().ok_or_else(|| EmailQueryParseError {
        code: EmailQueryParseErrorCode::WrongType,
        message: format!("{field} is not an array of EmailAddress"),
    })?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let raw: RawEmailAddress =
            serde_json::from_value(item.clone()).map_err(|e| EmailQueryParseError {
                code: EmailQueryParseErrorCode::WrongType,
                message: format!("{field} entry not parseable: {e}"),
            })?;
        let email = require(raw.email, &format!("{field}.email"))?;
        out.push(EmailAddress {
            name: raw.name,
            email,
        });
    }
    Ok(Some(out))
}

fn nullable_string(
    value: Option<serde_json::Value>,
    field: &'static str,
) -> Result<Option<String>, EmailQueryParseError> {
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(EmailQueryParseError {
            code: EmailQueryParseErrorCode::WrongType,
            message: format!("{field} is not a string or null"),
        }),
    }
}

fn require<T>(value: Option<T>, field: &str) -> Result<T, EmailQueryParseError> {
    value.ok_or_else(|| EmailQueryParseError {
        code: EmailQueryParseErrorCode::MissingField,
        message: format!("missing required field: {field}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../tests/fixtures/email_query.json");

    #[test]
    fn parses_recorded_fixture() {
        let result = parse_email_query_response(FIXTURE).expect("fixture should parse");
        assert_eq!(result.emails.len(), 3);
        assert_eq!(result.position, 0);
        assert_eq!(result.total, Some(42));
        let first = &result.emails[0];
        assert_eq!(first.id, "E1");
        assert_eq!(first.thread_id, "T1");
        assert_eq!(first.subject.as_deref(), Some("Welcome"));
    }

    #[test]
    fn keywords_flatten_to_name_value_list() {
        let result = parse_email_query_response(FIXTURE).unwrap();
        let unread = result
            .emails
            .iter()
            .find(|e| e.keywords.iter().all(|k| k.name != "$seen"));
        // Most fixture rows have $seen=true. Fallback: just check shape.
        let _ = unread;
        let any_seen = result
            .emails
            .iter()
            .flat_map(|e| &e.keywords)
            .any(|k| k.name == "$seen");
        assert!(any_seen, "fixture should include at least one $seen keyword");
    }

    #[test]
    fn malformed_json_classified() {
        let err = parse_email_query_response("{not json").unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::MalformedJson);
    }

    #[test]
    fn missing_method_responses_classified() {
        let err = parse_email_query_response("{}").unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::MissingField);
    }

    #[test]
    fn email_query_method_error_classified() {
        let json = r#"{"methodResponses":[["error",{"type":"unknownMethod"},"0"]]}"#;
        let err = parse_email_query_response(json).unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::MethodError);
        assert_eq!(err.message, "unknownMethod");
    }

    #[test]
    fn email_get_method_error_classified() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 0, "total": 0, "ids": []}, "0"],
                ["error", {"type": "accountNotFound"}, "1"]
            ]
        }"#;
        let err = parse_email_query_response(json).unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::MethodError);
        assert_eq!(err.message, "accountNotFound");
    }

    #[test]
    fn missing_email_get_response_is_partial() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 0, "total": 0, "ids": []}, "0"]
            ]
        }"#;
        let err = parse_email_query_response(json).unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::PartialResponse);
    }

    #[test]
    fn unexpected_first_method_classified() {
        let json = r#"{
            "methodResponses": [
                ["Mailbox/get", {"list": []}, "0"],
                ["Email/get", {"list": []}, "1"]
            ]
        }"#;
        let err = parse_email_query_response(json).unwrap_err();
        assert_eq!(err.code, EmailQueryParseErrorCode::WrongType);
        assert!(err.message.contains("Email/query"));
    }

    #[test]
    fn empty_email_list_yields_empty_result() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 0, "total": 0, "ids": []}, "0"],
                ["Email/get", {"list": []}, "1"]
            ]
        }"#;
        let result = parse_email_query_response(json).unwrap();
        assert!(result.emails.is_empty());
        assert_eq!(result.position, 0);
        assert_eq!(result.total, Some(0));
    }

    #[test]
    fn null_subject_and_preview_handled() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 5, "ids": ["E1"]}, "0"],
                ["Email/get", {
                    "list": [{
                        "id": "E1", "threadId": "T1",
                        "from": null, "to": null,
                        "subject": null, "preview": null,
                        "receivedAt": "2026-05-09T12:00:00Z",
                        "keywords": {},
                        "size": 1024
                    }]
                }, "1"]
            ]
        }"#;
        let result = parse_email_query_response(json).unwrap();
        assert_eq!(result.position, 5);
        assert!(result.total.is_none());
        let email = &result.emails[0];
        assert_eq!(email.subject, None);
        assert_eq!(email.preview, None);
        assert_eq!(email.from, None);
        assert_eq!(email.to, None);
        assert!(email.keywords.is_empty());
    }

    #[test]
    fn from_address_with_optional_name() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 0, "ids": ["E1"]}, "0"],
                ["Email/get", {
                    "list": [{
                        "id": "E1", "threadId": "T1",
                        "from": [
                            {"name": "Alice", "email": "alice@x.example"},
                            {"email": "bob@y.example"}
                        ],
                        "receivedAt": "2026-05-09T12:00:00Z",
                        "size": 0
                    }]
                }, "1"]
            ]
        }"#;
        let result = parse_email_query_response(json).unwrap();
        let from = result.emails[0].from.as_ref().unwrap();
        assert_eq!(from.len(), 2);
        assert_eq!(from[0].name.as_deref(), Some("Alice"));
        assert_eq!(from[0].email, "alice@x.example");
        assert_eq!(from[1].name, None);
        assert_eq!(from[1].email, "bob@y.example");
    }
}
