//! Pure parsing of a chained JMAP `Thread/get` + `Email/get` response.
//!
//! Wire shape (host sends two methodCalls in one JMAP request, RFC 8620
//! §3.7 — second uses a back-reference to the first):
//!
//! ```jsonc
//! {
//!   "methodResponses": [
//!     ["Thread/get", {
//!       "accountId": "...",
//!       "state": "...",
//!       "list": [{
//!         "id": "<threadId>",
//!         "emailIds": ["E1", "E2", ...]
//!       }],
//!       "notFound": []
//!     }, "0"],
//!     ["Email/get", {
//!       "accountId": "...",
//!       "state": "...",
//!       "list": [<email-full>, ...],
//!       "notFound": []
//!     }, "1"]
//!   ]
//! }
//! ```
//!
//! Per RFC 8621 §5.1, `Email/get` returns emails in `ids` order — and
//! since the back-reference pulls ids straight from
//! `Thread/get.list[0].emailIds`, the email order matches the thread's
//! chronological order without client-side re-sorting.
//!
//! Body-part flattening: JMAP's body model is a tree (`bodyValues` map
//! keyed by partId, plus `textBody`/`htmlBody`/`attachments` arrays
//! pointing into that map). For Phase 1's MessageView this layer
//! flattens to `body_text` / `body_html` strings — concatenating the
//! values referenced by `textBody` / `htmlBody` parts, in the order
//! JMAP listed them. Multipart/alternative selection is out of scope
//! here; a future minor bump can surface the structured body tree if
//! the UI grows to need it.

use serde::Deserialize;
use std::collections::BTreeMap;

use crate::parse_email::{EmailAddress, Keyword};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub id: String,
    pub name: Option<String>,
    pub mime_type: String,
    pub size: u64,
    pub cid: Option<String>,
    pub disposition: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailFull {
    pub id: String,
    pub thread_id: String,
    pub from: Option<Vec<EmailAddress>>,
    pub to: Option<Vec<EmailAddress>>,
    pub cc: Option<Vec<EmailAddress>>,
    pub bcc: Option<Vec<EmailAddress>>,
    pub subject: Option<String>,
    pub preview: Option<String>,
    pub received_at: String,
    pub sent_at: Option<String>,
    pub keywords: Vec<Keyword>,
    pub size: u64,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadGetResult {
    pub thread_id: String,
    pub email_ids: Vec<String>,
    pub emails: Vec<EmailFull>,
}

// Reuse `EmailQueryParseError` shape — same error vocabulary.
pub use crate::parse_email::{
    EmailQueryParseError as ThreadGetParseError,
    EmailQueryParseErrorCode as ThreadGetParseErrorCode,
};

// ──────────────────────────────────────────────────────────────────────
// Wire-shape deserializers
// ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RawResponse {
    #[serde(rename = "methodResponses")]
    method_responses: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct RawThreadGetPayload {
    list: Option<Vec<RawThread>>,
}

#[derive(Deserialize)]
struct RawThread {
    id: Option<String>,
    #[serde(rename = "emailIds")]
    email_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct RawEmailGetPayload {
    list: Option<Vec<RawFullEmail>>,
}

#[derive(Deserialize)]
struct RawFullEmail {
    id: Option<String>,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    from: Option<serde_json::Value>,
    to: Option<serde_json::Value>,
    cc: Option<serde_json::Value>,
    bcc: Option<serde_json::Value>,
    subject: Option<serde_json::Value>,
    preview: Option<serde_json::Value>,
    #[serde(rename = "receivedAt")]
    received_at: Option<String>,
    #[serde(rename = "sentAt")]
    sent_at: Option<serde_json::Value>,
    keywords: Option<BTreeMap<String, bool>>,
    size: Option<u64>,
    #[serde(rename = "bodyValues")]
    body_values: Option<BTreeMap<String, RawBodyValue>>,
    #[serde(rename = "textBody")]
    text_body: Option<Vec<RawBodyPart>>,
    #[serde(rename = "htmlBody")]
    html_body: Option<Vec<RawBodyPart>>,
    attachments: Option<Vec<RawBodyPart>>,
}

#[derive(Deserialize)]
struct RawBodyValue {
    value: Option<String>,
}

#[derive(Deserialize)]
struct RawBodyPart {
    #[serde(rename = "partId")]
    part_id: Option<String>,
    #[serde(rename = "blobId")]
    blob_id: Option<String>,
    #[serde(rename = "type")]
    mime_type: Option<String>,
    name: Option<String>,
    size: Option<u64>,
    cid: Option<String>,
    disposition: Option<String>,
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

pub fn parse_thread_get_response(json: &str) -> Result<ThreadGetResult, ThreadGetParseError> {
    let raw: RawResponse = serde_json::from_str(json).map_err(|e| {
        let code = match e.classify() {
            serde_json::error::Category::Data => ThreadGetParseErrorCode::WrongType,
            _ => ThreadGetParseErrorCode::MalformedJson,
        };
        ThreadGetParseError {
            code,
            message: e.to_string(),
        }
    })?;

    let method_responses = require(raw.method_responses, "methodResponses")?;
    if method_responses.is_empty() {
        return Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::EmptyResponse,
            message: "methodResponses array is empty".into(),
        });
    }

    // First entry: Thread/get
    let (thread_method, thread_payload) = decode_entry(&method_responses[0], "methodResponses[0]")?;
    if thread_method == "error" {
        return Err(method_error(thread_payload));
    }
    if thread_method != "Thread/get" {
        return Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("expected Thread/get first, got {thread_method}"),
        });
    }
    let thread_get: RawThreadGetPayload =
        serde_json::from_value(thread_payload).map_err(|e| ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("Thread/get payload not parseable: {e}"),
        })?;
    let thread_list = require(thread_get.list, "Thread/get.list")?;
    let thread = thread_list.into_iter().next().ok_or(ThreadGetParseError {
        code: ThreadGetParseErrorCode::MissingField,
        message: "Thread/get.list is empty (thread not found?)".into(),
    })?;
    let thread_id = require(thread.id, "Thread/get.list[0].id")?;
    let email_ids = require(thread.email_ids, "Thread/get.list[0].emailIds")?;

    // Second entry: Email/get
    if method_responses.len() < 2 {
        return Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::PartialResponse,
            message: "Thread/get response present but Email/get missing".into(),
        });
    }
    let (email_method, email_payload) = decode_entry(&method_responses[1], "methodResponses[1]")?;
    if email_method == "error" {
        return Err(method_error(email_payload));
    }
    if email_method != "Email/get" {
        return Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("expected Email/get second, got {email_method}"),
        });
    }
    let email_get: RawEmailGetPayload =
        serde_json::from_value(email_payload).map_err(|e| ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("Email/get payload not parseable: {e}"),
        })?;
    let raw_emails = require(email_get.list, "Email/get.list")?;

    let emails = raw_emails
        .into_iter()
        .map(into_full_email)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ThreadGetResult {
        thread_id,
        email_ids,
        emails,
    })
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

fn decode_entry(
    entry: &serde_json::Value,
    label: &'static str,
) -> Result<(String, serde_json::Value), ThreadGetParseError> {
    let arr = entry.as_array().ok_or_else(|| ThreadGetParseError {
        code: ThreadGetParseErrorCode::WrongType,
        message: format!("{label} is not an array"),
    })?;
    if arr.len() < 2 {
        return Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("{label} has {} elements, expected 3", arr.len()),
        });
    }
    let method_name = arr[0]
        .as_str()
        .ok_or_else(|| ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("{label}[0] is not a string method name"),
        })?
        .to_string();
    Ok((method_name, arr[1].clone()))
}

fn method_error(payload: serde_json::Value) -> ThreadGetParseError {
    let parsed: RawMethodErrorPayload =
        serde_json::from_value(payload).unwrap_or(RawMethodErrorPayload { error_type: None });
    ThreadGetParseError {
        code: ThreadGetParseErrorCode::MethodError,
        message: parsed.error_type.unwrap_or_else(|| "(no type)".into()),
    }
}

fn into_full_email(raw: RawFullEmail) -> Result<EmailFull, ThreadGetParseError> {
    let id = require(raw.id, "id")?;
    let thread_id = require(raw.thread_id, "threadId")?;
    let received_at = require(raw.received_at, "receivedAt")?;

    let body_values: BTreeMap<String, String> = raw
        .body_values
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(k, v)| v.value.map(|s| (k, s)))
        .collect();

    // Concatenate text and html bodies in the order JMAP returned them.
    // Multipart/alternative selection (prefer text vs html) is the
    // consumer's call — we surface both so the UI can pick.
    let body_text = concat_body(&raw.text_body, &body_values, "\n\n");
    let body_html = concat_body(&raw.html_body, &body_values, "\n");

    let attachments = raw
        .attachments
        .unwrap_or_default()
        .into_iter()
        .map(into_attachment)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(EmailFull {
        id,
        thread_id,
        from: parse_address_list(raw.from, "from")?,
        to: parse_address_list(raw.to, "to")?,
        cc: parse_address_list(raw.cc, "cc")?,
        bcc: parse_address_list(raw.bcc, "bcc")?,
        subject: nullable_string(raw.subject, "subject")?,
        preview: nullable_string(raw.preview, "preview")?,
        received_at,
        sent_at: nullable_string(raw.sent_at, "sentAt")?,
        keywords: raw
            .keywords
            .unwrap_or_default()
            .into_iter()
            .map(|(name, value)| Keyword { name, value })
            .collect(),
        size: raw.size.unwrap_or(0),
        body_text,
        body_html,
        attachments,
    })
}

fn concat_body(
    parts: &Option<Vec<RawBodyPart>>,
    body_values: &BTreeMap<String, String>,
    separator: &str,
) -> Option<String> {
    let parts = parts.as_ref()?;
    let mut chunks: Vec<&str> = Vec::new();
    for part in parts {
        let part_id = match &part.part_id {
            Some(id) => id,
            None => continue,
        };
        if let Some(value) = body_values.get(part_id) {
            chunks.push(value.as_str());
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join(separator))
    }
}

fn into_attachment(raw: RawBodyPart) -> Result<Attachment, ThreadGetParseError> {
    let id = require(raw.blob_id, "attachment.blobId")?;
    let mime_type = raw
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_string());
    Ok(Attachment {
        id,
        name: raw.name,
        mime_type,
        size: raw.size.unwrap_or(0),
        cid: raw.cid,
        disposition: raw.disposition,
    })
}

fn parse_address_list(
    value: Option<serde_json::Value>,
    field: &'static str,
) -> Result<Option<Vec<EmailAddress>>, ThreadGetParseError> {
    let v = match value {
        None => return Ok(None),
        Some(serde_json::Value::Null) => return Ok(None),
        Some(v) => v,
    };
    let arr = v.as_array().ok_or_else(|| ThreadGetParseError {
        code: ThreadGetParseErrorCode::WrongType,
        message: format!("{field} is not an array of EmailAddress"),
    })?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let raw: RawEmailAddress =
            serde_json::from_value(item.clone()).map_err(|e| ThreadGetParseError {
                code: ThreadGetParseErrorCode::WrongType,
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
) -> Result<Option<String>, ThreadGetParseError> {
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(ThreadGetParseError {
            code: ThreadGetParseErrorCode::WrongType,
            message: format!("{field} is not a string or null"),
        }),
    }
}

fn require<T>(value: Option<T>, field: &str) -> Result<T, ThreadGetParseError> {
    value.ok_or_else(|| ThreadGetParseError {
        code: ThreadGetParseErrorCode::MissingField,
        message: format!("missing required field: {field}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../tests/fixtures/thread_get.json");

    #[test]
    fn parses_recorded_fixture() {
        let result = parse_thread_get_response(FIXTURE).expect("fixture should parse");
        assert_eq!(result.thread_id, "T1");
        assert_eq!(result.email_ids, vec!["E1", "E2"]);
        assert_eq!(result.emails.len(), 2);
        assert_eq!(result.emails[0].id, "E1");
        assert_eq!(result.emails[1].id, "E2");
    }

    #[test]
    fn body_text_concatenated_in_order() {
        let result = parse_thread_get_response(FIXTURE).unwrap();
        let first = &result.emails[0];
        let text = first.body_text.as_deref().expect("expected body_text");
        assert!(text.contains("Hi Alice"), "got {text:?}");
    }

    #[test]
    fn body_html_concatenated_separately() {
        let result = parse_thread_get_response(FIXTURE).unwrap();
        let first = &result.emails[0];
        let html = first.body_html.as_deref().expect("expected body_html");
        assert!(html.contains("<p>Hi Alice"), "got {html:?}");
    }

    #[test]
    fn attachments_carry_cid_and_disposition() {
        let result = parse_thread_get_response(FIXTURE).unwrap();
        let second = &result.emails[1];
        assert_eq!(second.attachments.len(), 2);
        let inline = second.attachments.iter().find(|a| a.cid.is_some()).unwrap();
        assert_eq!(inline.cid.as_deref(), Some("logo@example"));
        assert_eq!(inline.disposition.as_deref(), Some("inline"));
        let pdf = second
            .attachments
            .iter()
            .find(|a| a.mime_type == "application/pdf")
            .unwrap();
        assert_eq!(pdf.name.as_deref(), Some("contract.pdf"));
        assert_eq!(pdf.size, 12345);
        assert_eq!(pdf.disposition.as_deref(), Some("attachment"));
    }

    #[test]
    fn parses_minimal_response() {
        let json = r#"{
            "methodResponses": [
                ["Thread/get", {
                    "list": [{"id": "T1", "emailIds": ["E1"]}]
                }, "0"],
                ["Email/get", {
                    "list": [{
                        "id": "E1",
                        "threadId": "T1",
                        "receivedAt": "2026-05-09T12:00:00Z",
                        "size": 100
                    }]
                }, "1"]
            ]
        }"#;
        let result = parse_thread_get_response(json).unwrap();
        assert_eq!(result.thread_id, "T1");
        let email = &result.emails[0];
        assert!(email.body_text.is_none());
        assert!(email.body_html.is_none());
        assert!(email.attachments.is_empty());
        assert_eq!(email.from, None);
        assert_eq!(email.cc, None);
    }

    #[test]
    fn malformed_json_classified() {
        let err = parse_thread_get_response("{not json").unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::MalformedJson);
    }

    #[test]
    fn missing_method_responses_classified() {
        let err = parse_thread_get_response("{}").unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::MissingField);
    }

    #[test]
    fn thread_get_method_error_classified() {
        let json = r#"{"methodResponses":[["error",{"type":"accountNotFound"},"0"]]}"#;
        let err = parse_thread_get_response(json).unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::MethodError);
        assert_eq!(err.message, "accountNotFound");
    }

    #[test]
    fn email_get_method_error_classified() {
        let json = r#"{
            "methodResponses": [
                ["Thread/get", {"list": [{"id": "T1", "emailIds": []}]}, "0"],
                ["error", {"type": "tooManyMethods"}, "1"]
            ]
        }"#;
        let err = parse_thread_get_response(json).unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::MethodError);
        assert_eq!(err.message, "tooManyMethods");
    }

    #[test]
    fn missing_email_get_response_is_partial() {
        let json = r#"{
            "methodResponses": [
                ["Thread/get", {"list": [{"id": "T1", "emailIds": []}]}, "0"]
            ]
        }"#;
        let err = parse_thread_get_response(json).unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::PartialResponse);
    }

    #[test]
    fn empty_thread_list_classified_as_missing_field() {
        let json = r#"{
            "methodResponses": [
                ["Thread/get", {"list": []}, "0"],
                ["Email/get", {"list": []}, "1"]
            ]
        }"#;
        let err = parse_thread_get_response(json).unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::MissingField);
        assert!(
            err.message.contains("Thread/get.list"),
            "got {}",
            err.message
        );
    }

    #[test]
    fn unexpected_first_method_classified() {
        let json = r#"{
            "methodResponses": [
                ["Email/query", {"position": 0, "ids": []}, "0"],
                ["Email/get", {"list": []}, "1"]
            ]
        }"#;
        let err = parse_thread_get_response(json).unwrap_err();
        assert_eq!(err.code, ThreadGetParseErrorCode::WrongType);
        assert!(err.message.contains("Thread/get"));
    }
}
