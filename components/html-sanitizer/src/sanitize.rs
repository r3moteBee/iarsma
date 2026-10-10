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
//!     Remote content covers `<img src>` *and* CSS `url(...)` in inline
//!     styles; both obey the same `allow_external_images` gate.
//!   - Containment. The output is injected into the shell's own DOM
//!     (not an iframe), so the sanitizer must not let the message
//!     escape its box or drive the webmail tab: no `position:
//!     fixed/absolute/sticky` overlays, no relative URLs (they resolve
//!     against the webmail origin), and every link opens in a new tab.
//!     The shell adds CSS containment on the body container as a second
//!     layer (thread-view.module.css `.msgBody`).

use ammonia::{Builder, UrlRelative};
use std::borrow::Cow;
use std::collections::HashSet;

/// Sanitize an HTML fragment.
///
/// `allow_external_images`:
///   - `false` (default for incoming mail): `<img>` tags with `http(s):`
///     `src` are stripped, and so are inline-style declarations that
///     `url(...)` anything other than `cid:` / `data:`. `cid:` and
///     `data:` URIs pass through.
///   - `true`: `http(s):` `src` and `url(http(s):...)` allowed too. The
///     user opted in.
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
    // `target` isn't allowlisted either: it's forced to `_blank` below,
    // so a sender can't use `_self` / `_top` / a named frame to
    // navigate the webmail tab itself.
    b.add_tag_attributes("a", ["href", "title"]);

    // URL scheme allowlist. ammonia's default allows several mail-
    // unfriendly schemes (chrome-extension, etc.); narrow to what the
    // shell actually surfaces, plus `cid:` (referenced inline
    // attachments) and `data:` (small inline images).
    let url_schemes: HashSet<&str> = ["http", "https", "mailto", "tel", "cid", "data"]
        .into_iter()
        .collect();
    b.url_schemes(url_schemes);

    // Relative URLs (`foo`, `/jmap/...`, `//host/x`, `#frag`,
    // `?q`) would resolve against the webmail's own origin rather than
    // anything the sender controls meaningfully — drop them from every
    // URL-bearing attribute (`href`, `src`).
    b.url_relative(UrlRelative::Deny);

    // Always anchor links to open in a new tab + apply
    // `noopener noreferrer` so the target page can't reach back into
    // our origin via window.opener. `set_tag_attribute_value`
    // overwrites any sender-supplied value as well as adding the
    // attribute when it's missing.
    b.set_tag_attribute_value("a", "target", "_blank");
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
            let filtered = filter_style(value, allow_external_images);
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

/// Filter a `style` attribute value to a safe subset.
///
/// The value is first normalized the way a CSS tokenizer would see it
/// (comments removed, escapes decoded — so `u\rl(`, `u\72 l(` and
/// `ur/**/l(` can't sneak past a substring check), then split into
/// declarations, and each declaration is screened by
/// [`screen_style_declaration`]. The *normalized* text is what gets
/// emitted, so the browser parses exactly the bytes that were checked.
///
/// Returns an empty string when nothing survives (the caller drops the
/// attribute).
fn filter_style(value: &str, allow_external_images: bool) -> String {
    let Some(normalized) = normalize_css(value) else {
        return String::new();
    };
    let mut out = String::with_capacity(normalized.len());
    for declaration in split_declarations(&normalized) {
        let decl = declaration.trim();
        if decl.is_empty() {
            continue;
        }
        let Some(decl) = screen_style_declaration(decl, allow_external_images) else {
            continue;
        };
        if !out.is_empty() {
            out.push_str("; ");
        }
        out.push_str(&decl);
    }
    out
}

/// Strip CSS comments and decode CSS escapes (CSS Syntax §4.3.7).
///
/// Returns `None` when the decoded text would itself re-introduce
/// escapes or comments (a decoded `\` or `/*`) — the browser would then
/// tokenize the emitted text differently from what we screened, so the
/// whole style attribute is dropped instead.
fn normalize_css(value: &str) -> Option<String> {
    // Input preprocessing: CRLF / CR / FF → LF, NUL → U+FFFD.
    let pre: Vec<char> = value
        .replace("\r\n", "\n")
        .chars()
        .map(|c| match c {
            '\r' | '\u{c}' => '\n',
            '\0' => '\u{fffd}',
            c => c,
        })
        .collect();

    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < pre.len() {
        let c = pre[i];
        if c == '/' && pre.get(i + 1) == Some(&'*') {
            // Comment: skip to the closing `*/` (or to the end when
            // unterminated, as the tokenizer does). Emit a space so
            // the tokens either side stay separate.
            let mut j = i + 2;
            while j < pre.len() && !(pre[j] == '*' && pre.get(j + 1) == Some(&'/')) {
                j += 1;
            }
            i = (j + 2).min(pre.len());
            out.push(' ');
            continue;
        }
        if c != '\\' {
            out.push(c);
            i += 1;
            continue;
        }
        // Escape.
        i += 1;
        let Some(&next) = pre.get(i) else {
            break; // `\` at EOF: dropped.
        };
        if next == '\n' {
            i += 1; // Escaped newline: line continuation, dropped.
            continue;
        }
        if next.is_ascii_hexdigit() {
            let mut code: u32 = 0;
            let mut digits = 0;
            while digits < 6 && i < pre.len() && pre[i].is_ascii_hexdigit() {
                code = code * 16 + pre[i].to_digit(16).unwrap_or(0);
                i += 1;
                digits += 1;
            }
            // One whitespace character after a hex escape is part of it.
            if matches!(pre.get(i), Some(' ' | '\t' | '\n')) {
                i += 1;
            }
            let decoded = match code {
                0 => '\u{fffd}',
                c => char::from_u32(c).unwrap_or('\u{fffd}'),
            };
            out.push(decoded);
        } else {
            out.push(next);
            i += 1;
        }
    }

    if out.contains('\\') || out.contains("/*") {
        return None;
    }
    Some(out)
}

/// Split a normalized declaration list on top-level `;`, honouring
/// quoted strings and parenthesized blocks the way the CSS parser does
/// (so `url(data:image/png;base64,...)` stays one declaration). A
/// newline ends an unterminated string, matching the tokenizer's
/// bad-string recovery.
fn split_declarations(css: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut quote: Option<char> = None;
    let mut depth: usize = 0;
    let mut start = 0;
    for (idx, c) in css.char_indices() {
        match quote {
            Some(q) => {
                if c == q || c == '\n' {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => quote = Some(c),
                '(' => depth += 1,
                ')' => depth = depth.saturating_sub(1),
                ';' if depth == 0 => {
                    parts.push(&css[start..idx]);
                    start = idx + 1;
                }
                _ => {}
            },
        }
    }
    parts.push(&css[start..]);
    parts
}

/// CSS functions that are never allowed in an inline style, matched on
/// the lowercased, normalized declaration:
///   - script / legacy-binding vectors: `expression(`;
///   - indirections that would let the value be computed from something
///     we didn't screen: `var(` (custom properties), `env(`, `attr(`
///     (reads e.g. the allowlisted `title` attribute);
///   - remote-fetching functions other than `url(` that take a bare
///     string URL: `image-set(` (incl. `-webkit-image-set(`), `image(`,
///     `src(`, `cross-fade(`; and `element(` (`-moz-element(`), which
///     paints other parts of the page.
const BLOCKED_CSS_FUNCTIONS: &[&str] = &[
    "expression(",
    "var(",
    "env(",
    "attr(",
    "image-set(",
    "image(",
    "src(",
    "cross-fade(",
    "element(",
];

/// Screen one normalized `property: value` declaration. Returns the
/// declaration to emit — unchanged, or with remote `url(...)`s replaced
/// by `none` while external content is blocked — or `None` to drop it.
fn screen_style_declaration(decl: &str, allow_external_images: bool) -> Option<Cow<'_, str>> {
    // ASCII lowercasing keeps byte offsets identical to `decl`, so
    // positions found in `lower` index `decl` too.
    let lower = decl.to_ascii_lowercase();

    let (property, value) = lower.split_once(':')?;
    let property = property.trim();
    // A plain (optionally vendor-prefixed) property name. Rejects custom
    // properties (`--x`), which only matter through `var()`.
    let mut chars = property.strip_prefix('-').unwrap_or(property).chars();
    if !chars.next().is_some_and(|c| c.is_ascii_lowercase())
        || !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return None;
    }
    if matches!(property, "behavior" | "-moz-binding") {
        return None;
    }
    // Containment: only in-flow positioning. `fixed` / `absolute` /
    // `sticky` let a message overlay the webmail chrome (e.g. a fake
    // sign-in form over the whole viewport).
    if property == "position" {
        let v = value.replace("!important", "");
        if !matches!(v.trim(), "static" | "relative") {
            return None;
        }
    }

    if lower.contains("javascript:")
        || lower.contains("vbscript:")
        || lower.contains("@import")
        || lower.contains('{')
        || lower.contains('}')
        || BLOCKED_CSS_FUNCTIONS.iter().any(|f| lower.contains(f))
    {
        return None;
    }

    // Every `url(...)` must parse cleanly and point at an allowed
    // scheme: `cid:` / `data:` always; relative URLs (which would
    // resolve against the webmail origin) and other schemes never.
    // `http(s):` is remote content: kept when the user opted in,
    // otherwise neutralized to `none` — `background: #123 url(...)`
    // keeps its colour instead of losing the whole declaration.
    let mut blocked_remote: Vec<std::ops::Range<usize>> = Vec::new();
    let mut search_from = 0;
    while let Some(pos) = lower[search_from..].find("url(") {
        let url_start = search_from + pos;
        let arg_start = url_start + "url(".len();
        let (url, consumed) = parse_css_url_arg(&decl[arg_start..])?;
        let url_end = arg_start + consumed;
        match css_url_scheme(url).as_deref() {
            Some("cid") | Some("data") => {}
            Some("http") | Some("https") if allow_external_images => {}
            Some("http") | Some("https") => blocked_remote.push(url_start..url_end),
            _ => return None,
        }
        search_from = url_end;
    }
    if blocked_remote.is_empty() {
        return Some(Cow::Borrowed(decl));
    }
    let mut rewritten = String::with_capacity(decl.len());
    let mut last = 0;
    for range in blocked_remote {
        rewritten.push_str(&decl[last..range.start]);
        rewritten.push_str("none");
        last = range.end;
    }
    rewritten.push_str(&decl[last..]);
    Some(Cow::Owned(rewritten))
}

/// Parse the argument of a `url(` function from just after the `(`.
/// Returns the URL and the number of bytes consumed through the closing
/// `)`, or `None` for anything malformed — including the unquoted forms
/// the tokenizer turns into a bad-url token (quotes, `(`, inner
/// whitespace), where our view of the declaration boundaries could
/// diverge from the browser's.
fn parse_css_url_arg(rest: &str) -> Option<(&str, usize)> {
    let is_ws = |c: char| matches!(c, ' ' | '\t' | '\n');
    let trimmed = rest.trim_start_matches(is_ws);
    let lead = rest.len() - trimmed.len();
    let (url, after_url) = match trimmed.chars().next()? {
        q @ ('"' | '\'') => {
            let body = &trimmed[1..];
            let end = body.find([q, '\n'])?;
            if !body[end..].starts_with(q) {
                return None;
            }
            (&body[..end], 1 + end + 1)
        }
        _ => {
            let end = trimmed.find(|c: char| c == ')' || is_ws(c))?;
            let url = &trimmed[..end];
            if url.contains(['"', '\'', '(']) || url.chars().any(|c| c.is_control()) {
                return None;
            }
            (url, end)
        }
    };
    let tail = &trimmed[after_url..];
    let tail_trimmed = tail.trim_start_matches(is_ws);
    if !tail_trimmed.starts_with(')') {
        return None;
    }
    let consumed = lead + after_url + (tail.len() - tail_trimmed.len()) + 1;
    Some((url, consumed))
}

/// The lowercased scheme of a URL (`https` for `https://x`), or `None`
/// when the URL is relative (no `scheme:` prefix per RFC 3986).
fn css_url_scheme(url: &str) -> Option<String> {
    let url = url.trim();
    let (scheme, _) = url.split_once(':')?;
    let mut chars = scheme.chars();
    if !chars.next()?.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    Some(scheme.to_ascii_lowercase())
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
    // CSS url() obeys the external-images gate
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn blocks_tracker_url_in_style_by_default() {
        let html =
            r#"<div style="color: red; background: url(https://tracker.example/p.gif)">x</div>"#;
        let out = sanitize(html, false);
        assert!(!out.contains("tracker.example"), "got {out:?}");
        assert!(out.contains("color: red"), "safe sibling kept: {out:?}");
    }

    #[test]
    fn blocked_remote_url_is_neutralized_not_dropped() {
        // Newsletter shorthand: the colour must survive the blocked image.
        let html = r#"<div style="background: #123456 url(https://t.example/a.png) no-repeat, url('https://t.example/b.png')">x</div>"#;
        let out = sanitize(html, false);
        assert!(
            out.contains("background: #123456 none no-repeat, none"),
            "got {out:?}"
        );
        let out = sanitize(html, true);
        assert!(out.contains("url(https://t.example/a.png)"), "got {out:?}");
    }

    #[test]
    fn allows_remote_url_in_style_when_toggle_set() {
        let html = r#"<div style="background-image: url('https://example.net/bg.png')">x</div>"#;
        let out = sanitize(html, true);
        assert!(
            out.contains("url('https://example.net/bg.png')"),
            "got {out:?}"
        );
    }

    #[test]
    fn blocks_obfuscated_remote_url_in_style() {
        for style in [
            "background: URL(https://t.example/p)",
            "background: Url( \"https://t.example/p\" )",
            r"background: u\rl(https://t.example/p)",
            r"background: u\72 l(https://t.example/p)",
            r"background: \75\72\6c(https://t.example/p)",
            "background:/**/url(https://t.example/p)",
            "background: url(//t.example/p)",
            "back/**/ground: url(https://t.example/p)",
            r"background: url(htt\70s://t.example/p)",
            "background-image: image-set(\"https://t.example/p\" 1x)",
            "background-image: -webkit-image-set(\"https://t.example/p\" 1x)",
            "background-image: src(\"https://t.example/p\")",
            "list-style-image: url(https://t.example/p)",
            "cursor: url(https://t.example/p), auto",
        ] {
            let html = format!("<div style='{style}'>x</div>");
            let out = sanitize(&html, false);
            assert!(!out.contains("t.example"), "{style:?} leaked: {out:?}");
        }
    }

    #[test]
    fn blocks_relative_and_script_urls_in_style_even_when_toggle_set() {
        for style in [
            "background: url(/jmap/download/x)",
            "background: url(pixel.gif)",
            "background: url(javascript:alert(1))",
            r"background: url(j\61vascript:alert(1))",
        ] {
            let html = format!("<div style='{style}'>x</div>");
            let out = sanitize(&html, true);
            assert!(!out.contains("url("), "{style:?} kept: {out:?}");
        }
    }

    #[test]
    fn keeps_cid_and_data_urls_in_style() {
        let html = r#"<div style="background: url(cid:bg@example); color: red">x</div>"#;
        assert_contains(html, false, "url(cid:bg@example)");
        // `;` inside the data URL must not split the declaration.
        let html = r#"<div style="background-image: url('data:image/png;base64,iVBORw0KGgo='); color: red">x</div>"#;
        let out = sanitize(html, false);
        assert!(
            out.contains("url('data:image/png;base64,iVBORw0KGgo=')"),
            "got {out:?}"
        );
        assert!(out.contains("color: red"), "got {out:?}");
    }

    #[test]
    fn malformed_url_does_not_smuggle_a_following_declaration() {
        // The tokenizer turns `url(data:x")` into a bad-url token and
        // would then parse `position: fixed` as its own declaration.
        let html = r#"<div style='background: url(data:x"); position: fixed; top: 0'>x</div>"#;
        let out = sanitize(html, true);
        assert!(!out.contains("fixed"), "got {out:?}");
    }

    // ──────────────────────────────────────────────────────────────────
    // Containment: no overlays, no indirection
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn strips_out_of_flow_positioning() {
        for value in [
            "fixed",
            "absolute",
            "sticky",
            "-webkit-sticky",
            "FIXED",
            "fixed !important",
            r"fi\78 ed",
            "fi/**/xed",
        ] {
            let html = format!(
                "<div style='position: {value}; inset: 0; z-index: 2147483647; color: blue'>x</div>"
            );
            let out = sanitize(&html, false);
            assert!(!out.contains("position"), "{value:?} kept: {out:?}");
            assert!(out.contains("color: blue"), "sibling dropped: {out:?}");
        }
    }

    #[test]
    fn keeps_in_flow_positioning() {
        assert_contains(
            r#"<div style="position: relative; top: 2px">x</div>"#,
            false,
            "position: relative",
        );
    }

    #[test]
    fn strips_css_indirection_and_custom_properties() {
        for style in [
            "--p: fixed",
            "position: var(--p)",
            "position: attr(title type(<custom-ident>))",
            "padding-top: env(safe-area-inset-top)",
            "background: -moz-element(#app)",
            "-moz-binding: url(https://evil/x.xml#b)",
            "color: red{}",
        ] {
            let html = format!("<div title='fixed' style='{style}'>x</div>");
            let out = sanitize(&html, true);
            assert!(!out.contains("style="), "{style:?} kept: {out:?}");
        }
    }

    #[test]
    fn drops_style_whose_decoding_reintroduces_escapes_or_comments() {
        for style in [r"color: red\5c 0", r"color: red\2f\2a x"] {
            let html = format!("<div style='{style}'>x</div>");
            let out = sanitize(&html, false);
            assert!(!out.contains("style="), "{style:?} kept: {out:?}");
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Links can't drive the webmail tab
    // ──────────────────────────────────────────────────────────────────

    #[test]
    fn forces_target_blank_on_links() {
        for target in ["_self", "_top", "_parent", "iarsma"] {
            let html = format!("<a href=\"https://example.net/\" target=\"{target}\">x</a>");
            let out = sanitize(&html, false);
            assert!(out.contains("target=\"_blank\""), "got {out:?}");
            assert!(!out.contains(target), "{target:?} kept: {out:?}");
        }
        let out = sanitize("<a href=\"https://example.net/\">x</a>", false);
        assert!(out.contains("target=\"_blank\""), "got {out:?}");
        assert!(out.contains("rel=\"noopener noreferrer\""), "got {out:?}");
    }

    #[test]
    fn strips_relative_urls() {
        for href in ["/settings", "inbox", "#compose", "?q=x", "//evil.example/x"] {
            let html = format!("<a href=\"{href}\">x</a>");
            let out = sanitize(&html, false);
            assert!(!out.contains("href"), "{href:?} kept: {out:?}");
        }
        let out = sanitize("<img src=\"/jmap/download/x\">", true);
        assert!(!out.contains("/jmap"), "got {out:?}");
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
