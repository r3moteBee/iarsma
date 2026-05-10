//! Pure sanitization logic.
//!
//! Lives in its own module so `cargo test` on the host target exercises
//! the protocol logic directly without needing a WASM runtime. The
//! component shell in `lib.rs` is a thin adapter from this module's API
//! to the WIT-generated types.
//!
//! Threat model:
//!   - Untrusted HTML from incoming mail. Anything we render in the
//!     shell needs to come through here. Sender-controlled bytes get
//!     restricted to a tag/attribute allowlist; the allowlist is the
//!     security boundary.
//!   - Two threat tiers — script execution (always blocked) and remote
//!     content (blocked by default, optionally allowed per-message).

use ammonia::Builder;
use std::borrow::Cow;
use std::collections::HashSet;

/// Sanitize an HTML fragment.
///
/// `allow_external_images`:
///   - `false` (default for incoming mail): `<img>` tags with `http(s):`
///     `src` are stripped. `cid:` and `data:` URIs pass through.
///   - `true`: `http(s):` `src` allowed too. The user opted in.
pub fn sanitize(html: &str, allow_external_images: bool) -> String {
    builder(allow_external_images).clean(html).to_string()
}

fn builder(allow_external_images: bool) -> Builder<'static> {
    let mut b = Builder::default();

    // Mail-friendly tag allowlist on top of ammonia's defaults. ammonia
    // ships with a sensible base; we add the structural / semantic
    // tags real-world HTML email leans on (tables for layout,
    // blockquote for quoted replies, dl/dt/dd for definition lists).
    // We never add <script>, <style>, <iframe>, <object>, <embed>,
    // <form>, <input>, <meta>, or <link> — those stay stripped.
    let extra_tags: HashSet<&str> = [
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "caption",
        "colgroup",
        "col",
        "blockquote",
        "pre",
        "code",
        "dl",
        "dt",
        "dd",
        "figure",
        "figcaption",
        "details",
        "summary",
        "address",
        "hr",
        "br",
        "kbd",
        "samp",
        "var",
        "small",
        "big",
        "sub",
        "sup",
        "ins",
        "del",
        "mark",
    ]
    .into_iter()
    .collect();
    b.add_tags(extra_tags);

    // Attribute allowlist: real HTML mail uses `style`, alignment +
    // size on table cells, `colspan`/`rowspan`, `bgcolor`. Allowed
    // here; `style` values get filtered to a safe subset below.
    b.add_generic_attributes(["style", "class", "title", "lang", "dir"]);
    b.add_tag_attributes(
        "table",
        [
            "width",
            "height",
            "align",
            "border",
            "cellpadding",
            "cellspacing",
            "bgcolor",
        ],
    );
    b.add_tag_attributes(
        "td",
        [
            "width", "height", "align", "valign", "colspan", "rowspan", "bgcolor",
        ],
    );
    b.add_tag_attributes(
        "th",
        [
            "width", "height", "align", "valign", "colspan", "rowspan", "bgcolor", "scope",
        ],
    );
    b.add_tag_attributes("tr", ["align", "valign", "bgcolor"]);
    b.add_tag_attributes("col", ["width", "align", "span"]);
    b.add_tag_attributes("colgroup", ["width", "align", "span"]);
    b.add_tag_attributes("img", ["src", "alt", "width", "height", "title"]);
    // Note: don't add `rel` to the <a> allowlist — `link_rel` below
    // owns that attribute (ammonia panics if both are configured).
    b.add_tag_attributes("a", ["href", "title", "target"]);

    // URL scheme allowlist. ammonia's default allows several mail-
    // unfriendly schemes (chrome-extension, etc.); narrow to what the
    // shell actually surfaces, plus `cid:` (referenced inline
    // attachments) and `data:` (small inline images).
    let url_schemes: HashSet<&str> = ["http", "https", "mailto", "tel", "cid", "data"]
        .into_iter()
        .collect();
    b.url_schemes(url_schemes);

    // Always anchor links to open in a new tab + apply
    // `noopener noreferrer` so the target page can't reach back into
    // our origin via window.opener.
    b.link_rel(Some("noopener noreferrer"));

    // Per-attribute filter, in this order:
    //   1. Strip URL-bearing attributes whose values look like script
    //      URIs (`javascript:`, `vbscript:`, etc.) even after evasion
    //      attempts (whitespace, control chars).
    //   2. When `allow_external_images` is false, strip `<img src>`
    //      that doesn't use a `cid:` or `data:` scheme.
    //   3. Filter `style` attribute values to a safe subset.
    //   4. Otherwise pass values through unchanged.
    b.attribute_filter(move |element, attribute, value| {
        // (1) Script-URI evasion catch-all.
        if matches!(
            (element, attribute),
            ("a", "href") | ("img", "src") | ("area", "href")
        ) && looks_like_script_url(value)
        {
            return None;
        }

        // (2) External-image gate.
        if element == "img" && attribute == "src" && !allow_external_images {
            let scheme = value.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
            match scheme.as_deref() {
                Some("cid") | Some("data") => {} // OK
                _ => return None,
            }
        }

        // (3) Inline-style filter.
        if attribute == "style" {
            let filtered = filter_style(value);
            if filtered.is_empty() {
                return None;
            }
            return Some(Cow::Owned(filtered));
        }

        // (4) Pass through.
        Some(Cow::Borrowed(value))
    });

    b
}

/// Detect URL-bearing attribute values that resolve to `javascript:`,
/// `vbscript:`, or `livescript:` after the typical evasions: leading
/// whitespace, control characters, mixed case.
fn looks_like_script_url(value: &str) -> bool {
    let trimmed: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .collect();
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("javascript:")
        || lower.starts_with("vbscript:")
        || lower.starts_with("livescript:")
}

/// Filter a `style` attribute value to a safe subset. Drops any
/// declaration whose value contains `expression(`, `javascript:`,
/// `url(javascript:`, `behavior:`, `vbscript:`, or `@import`. Keeps
/// simple `property: value` pairs that pass the screening.
fn filter_style(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut first = true;
    for declaration in value.split(';') {
        let decl = declaration.trim();
        if decl.is_empty() {
            continue;
        }
        if is_unsafe_style_declaration(decl) {
            continue;
        }
        if !first {
            out.push_str("; ");
        }
        out.push_str(decl);
        first = false;
    }
    out
}

fn is_unsafe_style_declaration(decl: &str) -> bool {
    let lower = decl.to_ascii_lowercase();
    lower.contains("expression(")
        || lower.contains("behavior:")
        || lower.contains("javascript:")
        || lower.contains("vbscript:")
        || lower.contains("@import")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_contains(html: &str, allow_external_images: bool, needle: &str) {
        let out = sanitize(html, allow_external_images);
        assert!(
            out.contains(needle),
            "expected output to contain {needle:?}; got {out:?}",
        );
    }

    fn assert_strips(html: &str, allow_external_images: bool, needle: &str) {
        let out = sanitize(html, allow_external_images);
        assert!(
            !out.contains(needle),
            "expected output to NOT contain {needle:?}; got {out:?}",
        );
    }

    // ──────────────────────────────────────────────────────────────────
    // Pathological cases (always blocked, regardless of toggles)
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn strips_script_tag() {
        assert_strips("<script>alert(1)</script>", false, "<script>");
        assert_strips("<script>alert(1)</script>", false, "alert");
    }

    #[test]
    fn strips_style_tag() {
        assert_strips("<style>body { x: y; }</style>", false, "<style>");
    }

    #[test]
    fn strips_iframe_object_embed() {
        assert_strips("<iframe src='https://evil'>", false, "<iframe");
        assert_strips("<object data='evil.swf'>", false, "<object");
        assert_strips("<embed src='evil.swf'>", false, "<embed");
    }

    #[test]
    fn strips_form_input_meta_link() {
        assert_strips(
            "<form action='evil'><input name='pw'></form>",
            false,
            "<form",
        );
        assert_strips(
            "<form action='evil'><input name='pw'></form>",
            false,
            "<input",
        );
        assert_strips(
            "<meta http-equiv='refresh' content='0;url=evil'>",
            false,
            "<meta",
        );
        assert_strips("<link rel='stylesheet' href='evil.css'>", false, "<link");
    }

    #[test]
    fn strips_event_handler_attributes() {
        assert_strips("<div onclick=\"alert(1)\">x</div>", false, "onclick");
        assert_strips(
            "<a href='#' onmouseover='evil()'>x</a>",
            false,
            "onmouseover",
        );
        assert_strips("<img src='cid:1' onerror='evil()'>", false, "onerror");
    }

    #[test]
    fn strips_javascript_uri_in_href() {
        let out = sanitize("<a href=\"javascript:alert(1)\">click</a>", false);
        assert!(!out.contains("javascript"), "got {out:?}");
    }

    #[test]
    fn strips_javascript_uri_with_whitespace_evasion() {
        let out = sanitize("<a href=\"  java\tscript:alert(1)\">x</a>", false);
        assert!(!out.contains("javascript"), "got {out:?}");
    }

    #[test]
    fn strips_vbscript_and_livescript_uris() {
        for prefix in ["vbscript", "livescript"] {
            let html = format!("<a href=\"{prefix}:evil()\">x</a>");
            let out = sanitize(&html, false);
            assert!(!out.contains(prefix), "got {out:?} from {html:?}");
        }
    }

    #[test]
    fn strips_css_expression_in_style() {
        let out = sanitize(
            r#"<div style="background: expression(alert(1))">x</div>"#,
            false,
        );
        assert!(!out.contains("expression"), "got {out:?}");
    }

    #[test]
    fn strips_javascript_url_in_style() {
        let out = sanitize(
            r#"<div style="background: url(javascript:alert(1))">x</div>"#,
            false,
        );
        assert!(!out.contains("javascript"), "got {out:?}");
    }

    #[test]
    fn strips_at_import_in_style() {
        let out = sanitize(r#"<div style="@import url('evil.css')">x</div>"#, false);
        assert!(!out.contains("@import"), "got {out:?}");
    }

    #[test]
    fn strips_behavior_in_style() {
        let out = sanitize(r#"<div style="behavior: url(evil.htc)">x</div>"#, false);
        assert!(!out.contains("behavior"), "got {out:?}");
    }

    // ──────────────────────────────────────────────────────────────────
    // Happy paths (preserved)
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn preserves_basic_text_formatting() {
        let html = "<p>Hello <b>world</b>, <i>how</i> are you?</p>";
        assert_contains(html, false, "<b>world</b>");
        assert_contains(html, false, "<i>how</i>");
        assert_contains(html, false, "<p>");
    }

    #[test]
    fn preserves_blockquote_for_quoted_replies() {
        let html = "<p>My reply.</p><blockquote><p>Their original.</p></blockquote>";
        assert_contains(html, false, "<blockquote>");
        assert_contains(html, false, "Their original.");
    }

    #[test]
    fn preserves_table_layout() {
        let html = r#"<table border="1"><tr><td colspan="2">Header</td></tr></table>"#;
        assert_contains(html, false, "<table");
        assert_contains(html, false, "<td");
        assert_contains(html, false, "colspan");
    }

    #[test]
    fn preserves_safe_inline_styles() {
        let out = sanitize(r#"<p style="color: red; font-size: 14px;">x</p>"#, false);
        assert!(out.contains("color: red"), "got {out:?}");
        assert!(out.contains("font-size: 14px"), "got {out:?}");
    }

    #[test]
    fn preserves_links_with_safe_schemes() {
        for scheme in ["http", "https", "mailto", "tel"] {
            let html = format!("<a href=\"{scheme}:example\">x</a>");
            assert_contains(&html, false, scheme);
        }
    }

    #[test]
    fn applies_noopener_noreferrer_to_external_links() {
        let out = sanitize("<a href=\"https://evil.example\">x</a>", false);
        assert!(out.contains("noopener noreferrer"), "got {out:?}");
    }

    // ──────────────────────────────────────────────────────────────────
    // External images toggle
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn blocks_external_image_by_default() {
        let out = sanitize("<img src=\"https://tracker.example/pixel.gif\">", false);
        assert!(
            !out.contains("tracker.example"),
            "external src leaked: {out:?}",
        );
    }

    #[test]
    fn allows_external_image_when_toggle_set() {
        let out = sanitize(
            "<img src=\"https://example.net/photo.jpg\" alt=\"photo\">",
            true,
        );
        assert!(out.contains("photo.jpg"), "expected src preserved: {out:?}");
        assert!(
            out.contains("alt=\"photo\""),
            "expected alt preserved: {out:?}"
        );
    }

    #[test]
    fn cid_image_passes_through_with_toggle_off() {
        let out = sanitize("<img src=\"cid:logo@example\" alt=\"logo\">", false);
        assert!(out.contains("cid:logo@example"), "got {out:?}");
    }

    #[test]
    fn data_image_passes_through_with_toggle_off() {
        let out = sanitize("<img src=\"data:image/png;base64,iVBORw0KGgo=\">", false);
        assert!(out.contains("data:image/png"), "got {out:?}");
    }

    // ──────────────────────────────────────────────────────────────────
    // Misc
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn empty_input_yields_empty_output() {
        assert_eq!(sanitize("", false), "");
    }

    #[test]
    fn handles_unicode_content() {
        let out = sanitize("<p>Hello 世界 — café</p>", false);
        assert!(out.contains("世界"), "got {out:?}");
        assert!(out.contains("café"), "got {out:?}");
    }

    #[test]
    fn handles_malformed_html_like_browsers_do() {
        let out = sanitize("<p>open <b>bold no close <i>nested", false);
        assert!(out.contains("open"));
        assert!(out.contains("bold no close"));
        assert!(out.contains("nested"));
    }

    #[test]
    fn empty_style_attribute_is_omitted_when_filtered_to_empty() {
        let out = sanitize(r#"<p style="expression(evil)">x</p>"#, false);
        assert!(!out.contains("expression"), "got {out:?}");
    }
}
