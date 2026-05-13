//! `iarsma:jmap-client` — thin JMAP client wrapper, parse-only (D-038).
//!
//! Pure parsing logic lives in `parse` (session) and `parse_mailbox`;
//! the WIT-component shell wires them into the cargo-component-generated
//! bindings. Bindings are gated on `target_arch = "wasm32"` so
//! `cargo test` on the host can exercise the protocol logic without a
//! WASM runtime.

mod parse;
mod parse_email;
mod parse_mailbox;
mod parse_thread_get;

// Re-export the host-target API. Useful for any rlib consumer (the
// component itself uses these via the `component` module below) and
// suppresses dead-code warnings on non-wasm builds.
pub use parse::{parse_session, ParseError, ParseErrorCode, SessionData};
pub use parse_email::{
    parse_email_query_response, EmailAddress, EmailQueryParseError, EmailQueryParseErrorCode,
    EmailQueryResult, EmailSummary, Keyword,
};
pub use parse_mailbox::{
    parse_mailbox_get_response, Mailbox, MailboxParseError, MailboxParseErrorCode, MailboxRights,
};
pub use parse_thread_get::{
    parse_thread_get_response, Attachment, EmailFull, ThreadGetParseError, ThreadGetParseErrorCode,
    ThreadGetResult,
};

// `include!` instead of `mod bindings;` so rustfmt doesn't recurse into
// the cargo-component-generated file. rustfmt follows `mod x;` even
// under cfg-gating; `include!` is opaque to it. The wrapping module
// preserves the `bindings::exports::iarsma::...` import path the
// component shell below relies on.
#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings {
    include!("bindings.rs");
}

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::bindings::exports::iarsma::jmap_client::email::{
        Attachment as WitAttachment, EmailAddress as WitEmailAddress, EmailFull as WitEmailFull,
        EmailQueryResult as WitEmailQueryResult, EmailSummary as WitEmailSummary,
        Guest as EmailGuest, Keyword as WitKeyword, ParseError as WitEmailParseError,
        ParseErrorCode as WitEmailParseErrorCode, ThreadGetResult as WitThreadGetResult,
    };
    use crate::bindings::exports::iarsma::jmap_client::mailbox::{
        Guest as MailboxGuest, Mailbox as WitMailbox, MailboxRights as WitMailboxRights,
        ParseError as WitMailboxParseError, ParseErrorCode as WitMailboxParseErrorCode,
    };
    use crate::bindings::exports::iarsma::jmap_client::session::{
        Guest as SessionGuest, ParseError as WitSessionParseError,
        ParseErrorCode as WitSessionParseErrorCode, Session as WitSession,
    };
    use crate::{parse, parse_email, parse_mailbox, parse_thread_get};

    pub struct Component;

    impl SessionGuest for Component {
        fn parse_session(json: String) -> Result<WitSession, WitSessionParseError> {
            parse::parse_session(&json)
                .map(|s| WitSession {
                    username: s.username,
                    api_url: s.api_url,
                    download_url: s.download_url,
                    upload_url: s.upload_url,
                    event_source_url: s.event_source_url,
                    state: s.state,
                    primary_account_id_mail: s.primary_account_id_mail,
                })
                .map_err(|e| WitSessionParseError {
                    code: match e.code {
                        parse::ParseErrorCode::MalformedJson => {
                            WitSessionParseErrorCode::MalformedJson
                        }
                        parse::ParseErrorCode::MissingField => {
                            WitSessionParseErrorCode::MissingField
                        }
                        parse::ParseErrorCode::WrongType => WitSessionParseErrorCode::WrongType,
                        parse::ParseErrorCode::NoMailAccount => {
                            WitSessionParseErrorCode::NoMailAccount
                        }
                    },
                    message: e.message,
                })
        }
    }

    impl MailboxGuest for Component {
        fn parse_mailbox_get_response(
            json: String,
        ) -> Result<Vec<WitMailbox>, WitMailboxParseError> {
            parse_mailbox::parse_mailbox_get_response(&json)
                .map(|list| list.into_iter().map(into_wit_mailbox).collect())
                .map_err(|e| WitMailboxParseError {
                    code: match e.code {
                        parse_mailbox::MailboxParseErrorCode::MalformedJson => {
                            WitMailboxParseErrorCode::MalformedJson
                        }
                        parse_mailbox::MailboxParseErrorCode::MissingField => {
                            WitMailboxParseErrorCode::MissingField
                        }
                        parse_mailbox::MailboxParseErrorCode::WrongType => {
                            WitMailboxParseErrorCode::WrongType
                        }
                        parse_mailbox::MailboxParseErrorCode::EmptyResponse => {
                            WitMailboxParseErrorCode::EmptyResponse
                        }
                        parse_mailbox::MailboxParseErrorCode::MethodError => {
                            WitMailboxParseErrorCode::MethodError
                        }
                    },
                    message: e.message,
                })
        }
    }

    fn into_wit_mailbox(m: parse_mailbox::Mailbox) -> WitMailbox {
        WitMailbox {
            id: m.id,
            name: m.name,
            parent_id: m.parent_id,
            role: m.role,
            sort_order: m.sort_order,
            total_emails: m.total_emails,
            unread_emails: m.unread_emails,
            total_threads: m.total_threads,
            unread_threads: m.unread_threads,
            is_subscribed: m.is_subscribed,
            my_rights: WitMailboxRights {
                may_read_items: m.my_rights.may_read_items,
                may_add_items: m.my_rights.may_add_items,
                may_remove_items: m.my_rights.may_remove_items,
                may_set_seen: m.my_rights.may_set_seen,
                may_set_keywords: m.my_rights.may_set_keywords,
                may_create_child: m.my_rights.may_create_child,
                may_rename: m.my_rights.may_rename,
                may_delete: m.my_rights.may_delete,
                may_submit: m.my_rights.may_submit,
            },
        }
    }

    impl EmailGuest for Component {
        fn parse_email_query_response(
            json: String,
        ) -> Result<WitEmailQueryResult, WitEmailParseError> {
            parse_email::parse_email_query_response(&json)
                .map(|r| WitEmailQueryResult {
                    emails: r.emails.into_iter().map(into_wit_email_summary).collect(),
                    position: r.position,
                    total: r.total,
                })
                .map_err(|e| WitEmailParseError {
                    code: match e.code {
                        parse_email::EmailQueryParseErrorCode::MalformedJson => {
                            WitEmailParseErrorCode::MalformedJson
                        }
                        parse_email::EmailQueryParseErrorCode::MissingField => {
                            WitEmailParseErrorCode::MissingField
                        }
                        parse_email::EmailQueryParseErrorCode::WrongType => {
                            WitEmailParseErrorCode::WrongType
                        }
                        parse_email::EmailQueryParseErrorCode::EmptyResponse => {
                            WitEmailParseErrorCode::EmptyResponse
                        }
                        parse_email::EmailQueryParseErrorCode::MethodError => {
                            WitEmailParseErrorCode::MethodError
                        }
                        parse_email::EmailQueryParseErrorCode::PartialResponse => {
                            WitEmailParseErrorCode::PartialResponse
                        }
                    },
                    message: e.message,
                })
        }

        fn parse_thread_get_response(
            json: String,
        ) -> Result<WitThreadGetResult, WitEmailParseError> {
            parse_thread_get::parse_thread_get_response(&json)
                .map(|r| WitThreadGetResult {
                    thread_id: r.thread_id,
                    email_ids: r.email_ids,
                    emails: r.emails.into_iter().map(into_wit_email_full).collect(),
                })
                .map_err(|e| WitEmailParseError {
                    // ThreadGetParseError aliases to the same shape +
                    // codes as EmailQueryParseError, so the mapping is
                    // identical. Kept explicit per-arm so a future
                    // divergence surfaces as a compile error.
                    code: match e.code {
                        parse_email::EmailQueryParseErrorCode::MalformedJson => {
                            WitEmailParseErrorCode::MalformedJson
                        }
                        parse_email::EmailQueryParseErrorCode::MissingField => {
                            WitEmailParseErrorCode::MissingField
                        }
                        parse_email::EmailQueryParseErrorCode::WrongType => {
                            WitEmailParseErrorCode::WrongType
                        }
                        parse_email::EmailQueryParseErrorCode::EmptyResponse => {
                            WitEmailParseErrorCode::EmptyResponse
                        }
                        parse_email::EmailQueryParseErrorCode::MethodError => {
                            WitEmailParseErrorCode::MethodError
                        }
                        parse_email::EmailQueryParseErrorCode::PartialResponse => {
                            WitEmailParseErrorCode::PartialResponse
                        }
                    },
                    message: e.message,
                })
        }
    }

    fn into_wit_email_full(e: parse_thread_get::EmailFull) -> WitEmailFull {
        WitEmailFull {
            id: e.id,
            thread_id: e.thread_id,
            from: e
                .from
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            to: e
                .to
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            cc: e
                .cc
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            bcc: e
                .bcc
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            subject: e.subject,
            preview: e.preview,
            received_at: e.received_at,
            sent_at: e.sent_at,
            keywords: e
                .keywords
                .into_iter()
                .map(|k| WitKeyword {
                    name: k.name,
                    value: k.value,
                })
                .collect(),
            size: e.size,
            body_text: e.body_text,
            body_html: e.body_html,
            attachments: e.attachments.into_iter().map(into_wit_attachment).collect(),
            message_id: e.message_id,
            in_reply_to: e.in_reply_to,
            references: e.references,
        }
    }

    fn into_wit_attachment(a: parse_thread_get::Attachment) -> WitAttachment {
        WitAttachment {
            id: a.id,
            name: a.name,
            type_: a.mime_type,
            size: a.size,
            cid: a.cid,
            disposition: a.disposition,
        }
    }

    fn into_wit_email_summary(e: parse_email::EmailSummary) -> WitEmailSummary {
        WitEmailSummary {
            id: e.id,
            thread_id: e.thread_id,
            from: e
                .from
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            to: e
                .to
                .map(|list| list.into_iter().map(into_wit_address).collect()),
            subject: e.subject,
            preview: e.preview,
            received_at: e.received_at,
            keywords: e
                .keywords
                .into_iter()
                .map(|k| WitKeyword {
                    name: k.name,
                    value: k.value,
                })
                .collect(),
            size: e.size,
        }
    }

    fn into_wit_address(a: parse_email::EmailAddress) -> WitEmailAddress {
        WitEmailAddress {
            name: a.name,
            email: a.email,
        }
    }
}

#[cfg(target_arch = "wasm32")]
use component::Component;

#[cfg(target_arch = "wasm32")]
bindings::export!(Component with_types_in bindings);
