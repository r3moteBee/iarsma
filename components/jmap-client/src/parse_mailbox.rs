//! Pure parsing of a JMAP `Mailbox/get` method response.
//!
//! Lives in its own module so `cargo test` on the host target exercises
//! the protocol logic directly without needing a WASM runtime. The
//! component shell in `lib.rs` is a thin adapter from this module's
//! types to the WIT-generated types.
//!
//! Wire shape (RFC 8620 §3 + RFC 8621 §2):
//!
//! ```jsonc
//! {
//!   "methodResponses": [
//!     ["Mailbox/get", {
//!       "accountId": "...",
//!       "state": "...",
//!       "list": [<mailbox>, <mailbox>, ...]
//!     }, "<callId>"]
//!   ]
//! }
//! ```
//!
//! Or an error response:
//!
//! ```jsonc
//! { "methodResponses": [["error", {"type": "..."}, "<callId>"]] }
//! ```

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxRights {
    pub may_read_items: bool,
    pub may_add_items: bool,
    pub may_remove_items: bool,
    pub may_set_seen: bool,
    pub may_set_keywords: bool,
    pub may_create_child: bool,
    pub may_rename: bool,
    pub may_delete: bool,
    pub may_submit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub role: Option<String>,
    pub sort_order: u32,
    pub total_emails: u64,
    pub unread_emails: u64,
    pub total_threads: u64,
    pub unread_threads: u64,
    pub is_subscribed: bool,
    pub my_rights: MailboxRights,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MailboxParseErrorCode {
    MalformedJson,
    MissingField,
    WrongType,
    EmptyResponse,
    MethodError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxParseError {
    pub code: MailboxParseErrorCode,
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
struct RawMailboxGetPayload {
    list: Option<Vec<RawMailbox>>,
}

#[derive(Deserialize)]
struct RawMailbox {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "parentId")]
    parent_id: Option<serde_json::Value>,
    role: Option<serde_json::Value>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<u32>,
    #[serde(rename = "totalEmails")]
    total_emails: Option<u64>,
    #[serde(rename = "unreadEmails")]
    unread_emails: Option<u64>,
    #[serde(rename = "totalThreads")]
    total_threads: Option<u64>,
    #[serde(rename = "unreadThreads")]
    unread_threads: Option<u64>,
    #[serde(rename = "isSubscribed")]
    is_subscribed: Option<bool>,
    #[serde(rename = "myRights")]
    my_rights: Option<RawMailboxRights>,
}

#[derive(Deserialize)]
struct RawMailboxRights {
    #[serde(rename = "mayReadItems")]
    may_read_items: Option<bool>,
    #[serde(rename = "mayAddItems")]
    may_add_items: Option<bool>,
    #[serde(rename = "mayRemoveItems")]
    may_remove_items: Option<bool>,
    #[serde(rename = "maySetSeen")]
    may_set_seen: Option<bool>,
    #[serde(rename = "maySetKeywords")]
    may_set_keywords: Option<bool>,
    #[serde(rename = "mayCreateChild")]
    may_create_child: Option<bool>,
    #[serde(rename = "mayRename")]
    may_rename: Option<bool>,
    #[serde(rename = "mayDelete")]
    may_delete: Option<bool>,
    #[serde(rename = "maySubmit")]
    may_submit: Option<bool>,
}

#[derive(Deserialize)]
struct RawMethodErrorPayload {
    #[serde(rename = "type")]
    error_type: Option<String>,
}

// ──────────────────────────────────────────────────────────────────────
// Public parser
// ──────────────────────────────────────────────────────────────────────

pub fn parse_mailbox_get_response(json: &str) -> Result<Vec<Mailbox>, MailboxParseError> {
    let raw: RawResponse = serde_json::from_str(json).map_err(|e| {
        let code = match e.classify() {
            serde_json::error::Category::Data => MailboxParseErrorCode::WrongType,
            _ => MailboxParseErrorCode::MalformedJson,
        };
        MailboxParseError {
            code,
            message: e.to_string(),
        }
    })?;

    let method_responses = require(raw.method_responses, "methodResponses")?;
    if method_responses.is_empty() {
        return Err(MailboxParseError {
            code: MailboxParseErrorCode::EmptyResponse,
            message: "methodResponses array is empty".into(),
        });
    }

    // The first method response is the one we asked for. Each entry is a
    // 3-tuple: [method_name, payload, call_id].
    let entry = &method_responses[0];
    let arr = entry.as_array().ok_or_else(|| MailboxParseError {
        code: MailboxParseErrorCode::WrongType,
        message: "methodResponses[0] is not an array".into(),
    })?;
    if arr.len() < 2 {
        return Err(MailboxParseError {
            code: MailboxParseErrorCode::WrongType,
            message: format!("methodResponses[0] has {} elements, expected 3", arr.len()),
        });
    }

    let method_name = arr[0].as_str().ok_or_else(|| MailboxParseError {
        code: MailboxParseErrorCode::WrongType,
        message: "methodResponses[0][0] is not a string method name".into(),
    })?;

    if method_name == "error" {
        let payload: RawMethodErrorPayload =
            serde_json::from_value(arr[1].clone()).map_err(|e| MailboxParseError {
                code: MailboxParseErrorCode::WrongType,
                message: format!("error payload not parseable: {e}"),
            })?;
        return Err(MailboxParseError {
            code: MailboxParseErrorCode::MethodError,
            message: payload.error_type.unwrap_or_else(|| "(no type)".into()),
        });
    }

    if method_name != "Mailbox/get" {
        return Err(MailboxParseError {
            code: MailboxParseErrorCode::WrongType,
            message: format!("expected Mailbox/get response, got {method_name}"),
        });
    }

    let payload: RawMailboxGetPayload =
        serde_json::from_value(arr[1].clone()).map_err(|e| MailboxParseError {
            code: MailboxParseErrorCode::WrongType,
            message: format!("Mailbox/get payload not parseable: {e}"),
        })?;
    let raw_list = require(payload.list, "Mailbox/get.list")?;

    raw_list.into_iter().map(into_mailbox).collect()
}

fn into_mailbox(raw: RawMailbox) -> Result<Mailbox, MailboxParseError> {
    let id = require(raw.id, "id")?;
    let name = require(raw.name, "name")?;
    Ok(Mailbox {
        id,
        name,
        parent_id: nullable_string(raw.parent_id, "parentId")?,
        role: nullable_string(raw.role, "role")?,
        sort_order: raw.sort_order.unwrap_or(0),
        total_emails: raw.total_emails.unwrap_or(0),
        unread_emails: raw.unread_emails.unwrap_or(0),
        total_threads: raw.total_threads.unwrap_or(0),
        unread_threads: raw.unread_threads.unwrap_or(0),
        is_subscribed: raw.is_subscribed.unwrap_or(true),
        my_rights: rights_of(raw.my_rights),
    })
}

fn rights_of(raw: Option<RawMailboxRights>) -> MailboxRights {
    let r = raw.unwrap_or(RawMailboxRights {
        may_read_items: None,
        may_add_items: None,
        may_remove_items: None,
        may_set_seen: None,
        may_set_keywords: None,
        may_create_child: None,
        may_rename: None,
        may_delete: None,
        may_submit: None,
    });
    MailboxRights {
        may_read_items: r.may_read_items.unwrap_or(true),
        may_add_items: r.may_add_items.unwrap_or(false),
        may_remove_items: r.may_remove_items.unwrap_or(false),
        may_set_seen: r.may_set_seen.unwrap_or(false),
        may_set_keywords: r.may_set_keywords.unwrap_or(false),
        may_create_child: r.may_create_child.unwrap_or(false),
        may_rename: r.may_rename.unwrap_or(false),
        may_delete: r.may_delete.unwrap_or(false),
        may_submit: r.may_submit.unwrap_or(false),
    }
}

/// `parentId` and `role` come over the wire as either a string or
/// `null`. Treat both `None` (field absent) and `Some(Null)` as "absent".
fn nullable_string(
    value: Option<serde_json::Value>,
    field: &'static str,
) -> Result<Option<String>, MailboxParseError> {
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(_) => Err(MailboxParseError {
            code: MailboxParseErrorCode::WrongType,
            message: format!("{field} is not a string or null"),
        }),
    }
}

fn require<T>(value: Option<T>, field: &str) -> Result<T, MailboxParseError> {
    value.ok_or_else(|| MailboxParseError {
        code: MailboxParseErrorCode::MissingField,
        message: format!("missing required field: {field}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../tests/fixtures/mailbox_get.json");

    #[test]
    fn parses_recorded_fixture() {
        let mailboxes = parse_mailbox_get_response(FIXTURE).expect("fixture should parse");
        // Inbox + Sent + Drafts + Trash + a custom subfolder = 5 entries.
        assert_eq!(mailboxes.len(), 5);
        let inbox = mailboxes
            .iter()
            .find(|m| m.role.as_deref() == Some("inbox"))
            .unwrap();
        assert_eq!(inbox.name, "Inbox");
        assert!(inbox.parent_id.is_none());
        assert_eq!(inbox.unread_emails, 3);
    }

    #[test]
    fn flat_array_includes_nested_subfolder() {
        // The component returns a flat list; the host folds the tree.
        let mailboxes = parse_mailbox_get_response(FIXTURE).unwrap();
        let project = mailboxes.iter().find(|m| m.name == "Project").unwrap();
        assert!(project.parent_id.is_some());
    }

    #[test]
    fn parses_minimal_response() {
        let json = r#"{
            "methodResponses": [
                ["Mailbox/get", {
                    "accountId": "c",
                    "state": "1",
                    "list": [{
                        "id": "M1",
                        "name": "Inbox",
                        "parentId": null,
                        "role": "inbox",
                        "sortOrder": 0,
                        "totalEmails": 0,
                        "unreadEmails": 0,
                        "totalThreads": 0,
                        "unreadThreads": 0,
                        "isSubscribed": true,
                        "myRights": {
                            "mayReadItems": true, "mayAddItems": true,
                            "mayRemoveItems": true, "maySetSeen": true,
                            "maySetKeywords": true, "mayCreateChild": true,
                            "mayRename": false, "mayDelete": false,
                            "maySubmit": false
                        }
                    }]
                }, "0"]
            ]
        }"#;
        let mailboxes = parse_mailbox_get_response(json).unwrap();
        assert_eq!(mailboxes.len(), 1);
        let m = &mailboxes[0];
        assert_eq!(m.id, "M1");
        assert_eq!(m.parent_id, None);
        assert_eq!(m.role.as_deref(), Some("inbox"));
        assert!(m.my_rights.may_add_items);
        assert!(!m.my_rights.may_delete);
    }

    #[test]
    fn malformed_json_classified() {
        let err = parse_mailbox_get_response("{not json").unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::MalformedJson);
    }

    #[test]
    fn missing_method_responses_classified() {
        let err = parse_mailbox_get_response("{}").unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::MissingField);
        assert!(err.message.contains("methodResponses"), "{}", err.message);
    }

    #[test]
    fn empty_method_responses_classified() {
        let err = parse_mailbox_get_response(r#"{"methodResponses":[]}"#).unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::EmptyResponse);
    }

    #[test]
    fn error_method_response_classified() {
        let json = r#"{"methodResponses":[["error",{"type":"accountNotFound"},"0"]]}"#;
        let err = parse_mailbox_get_response(json).unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::MethodError);
        assert_eq!(err.message, "accountNotFound");
    }

    #[test]
    fn unexpected_method_name_classified() {
        let json = r#"{"methodResponses":[["Mailbox/changes",{"list":[]},"0"]]}"#;
        let err = parse_mailbox_get_response(json).unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::WrongType);
        assert!(err.message.contains("Mailbox/changes"));
    }

    #[test]
    fn nullable_parent_id_handled() {
        let json = r#"{
            "methodResponses": [["Mailbox/get", {
                "list": [{"id":"M1","name":"Inbox","parentId":null}]
            }, "0"]]
        }"#;
        let mailboxes = parse_mailbox_get_response(json).unwrap();
        assert_eq!(mailboxes[0].parent_id, None);
    }

    #[test]
    fn string_parent_id_handled() {
        let json = r#"{
            "methodResponses": [["Mailbox/get", {
                "list": [{"id":"M2","name":"Sub","parentId":"M1"}]
            }, "0"]]
        }"#;
        let mailboxes = parse_mailbox_get_response(json).unwrap();
        assert_eq!(mailboxes[0].parent_id.as_deref(), Some("M1"));
    }

    #[test]
    fn missing_per_mailbox_field_classified() {
        // Missing `name` should fail.
        let json = r#"{
            "methodResponses": [["Mailbox/get", {
                "list": [{"id":"M1"}]
            }, "0"]]
        }"#;
        let err = parse_mailbox_get_response(json).unwrap_err();
        assert_eq!(err.code, MailboxParseErrorCode::MissingField);
        assert!(err.message.contains("name"), "{}", err.message);
    }

    #[test]
    fn missing_optional_counts_default_to_zero() {
        let json = r#"{
            "methodResponses": [["Mailbox/get", {
                "list": [{"id":"M1","name":"Inbox"}]
            }, "0"]]
        }"#;
        let mailboxes = parse_mailbox_get_response(json).unwrap();
        let m = &mailboxes[0];
        assert_eq!(m.total_emails, 0);
        assert_eq!(m.unread_emails, 0);
        assert_eq!(m.sort_order, 0);
        assert!(m.is_subscribed);
    }
}
