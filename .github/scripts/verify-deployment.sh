#!/usr/bin/env bash
#
# Smoke-check a deployed Iarsma bundle. Confirms:
#   - the bundle's index.html is reachable
#   - version.json is served + parses
#   - the configured config.json is reachable + has the required fields
#   - the OIDC issuer's discovery doc is reachable + sends CORS headers
#     for the deploy origin
#
# Usage:
#   ./scripts-public/verify-deployment.sh https://mail.example.net/iarsma
#
# Exit code is 0 on success, non-zero on the first failure with a
# diagnostic message identifying which check tripped.
#
# Designed for tag-driven post-release verification: run it after
# bumping the Stalwart Web Application's resource URL or pushing a
# new release.

set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
    echo "usage: $0 <bundle-base-url>" >&2
    echo "  e.g.: $0 https://mail.example.net/iarsma" >&2
    exit 2
fi

# Trim a single trailing slash for cleaner URL composition.
BASE_URL="${BASE_URL%/}"

red='\033[0;31m'
green='\033[0;32m'
nc='\033[0m'
fail() { printf "${red}✗${nc} %s\n" "$1" >&2; exit 1; }
ok()   { printf "${green}✓${nc} %s\n" "$1"; }

# ── 1. index.html ─────────────────────────────────────────────────
status="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/")"
if [[ "$status" != "200" ]]; then
    fail "GET $BASE_URL/ returned HTTP $status (expected 200)"
fi
ok "index.html reachable at $BASE_URL/"

# ── 2. version.json ───────────────────────────────────────────────
version_body="$(curl -sS "$BASE_URL/version.json" || true)"
if ! jq -e '.version' >/dev/null 2>&1 <<<"$version_body"; then
    fail "GET $BASE_URL/version.json did not return a JSON document with a 'version' field"
fi
version="$(jq -r '.version' <<<"$version_body")"
built_at="$(jq -r '.builtAt // "unknown"' <<<"$version_body")"
ok "version.json: $version (built $built_at)"

# ── 3. config.json (operator-supplied) ────────────────────────────
config_body="$(curl -sS -w "\n%{http_code}" "$BASE_URL/config.json" || true)"
config_status="${config_body##*$'\n'}"
config_json="${config_body%$'\n'*}"
if [[ "$config_status" != "200" ]]; then
    fail "GET $BASE_URL/config.json returned HTTP $config_status — operator must drop the file alongside the bundle"
fi
for field in oidcIssuer clientId redirectUri; do
    if ! jq -e ".${field}" >/dev/null 2>&1 <<<"$config_json"; then
        fail "config.json missing required field: $field"
    fi
done
issuer="$(jq -r '.oidcIssuer' <<<"$config_json")"
client="$(jq -r '.clientId' <<<"$config_json")"
redirect="$(jq -r '.redirectUri' <<<"$config_json")"
ok "config.json present: oidcIssuer=$issuer, clientId=$client"

# ── 4. redirectUri sanity ─────────────────────────────────────────
if [[ "$redirect" != https://* ]] && [[ "$redirect" != http://localhost* ]] && [[ "$redirect" != http://127.0.0.1* ]]; then
    fail "redirectUri must be HTTPS (Stalwart's policy) or http://localhost(:port) for dev: $redirect"
fi
ok "redirectUri scheme acceptable: $redirect"

# ── 5. OIDC discovery + CORS ──────────────────────────────────────
oidc_url="$issuer/.well-known/openid-configuration"
discovery="$(curl -sS -H "Origin: $BASE_URL" -i "$oidc_url" || true)"
if ! grep -qiE '^HTTP/[0-9.]+ 200' <<<"$discovery"; then
    fail "GET $oidc_url did not return 200 — issuer unreachable or wrong"
fi
deploy_origin="$(printf '%s' "$BASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"
allowed_origin="$(grep -i '^access-control-allow-origin:' <<<"$discovery" | tr -d '\r' | sed 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:[[:space:]]*//')"
if [[ -z "$allowed_origin" ]]; then
    fail "OIDC discovery response carries no access-control-allow-origin — Stalwart's HTTP→General→Custom Response Headers needs configuring"
fi
if [[ "$allowed_origin" != "*" && "$allowed_origin" != "$deploy_origin" ]]; then
    fail "OIDC discovery sends access-control-allow-origin: $allowed_origin — does not match deploy origin $deploy_origin"
fi
ok "OIDC discovery + CORS reachable from $deploy_origin"

# ── 6. JMAP capability spot-check ─────────────────────────────────
jmap_body="$(curl -sS "$issuer/.well-known/jmap" || true)"
# Anonymous request returns 401 typically, but the response should still
# be JSON-shaped. Tolerate the auth gate; we just want to confirm the
# endpoint exists and resolves on this origin.
if [[ "$jmap_body" == *'"capabilities"'* ]] || [[ "$jmap_body" == *'unauthorized'* ]] || [[ "$jmap_body" == *'authenticate'* ]]; then
    ok "JMAP endpoint $issuer/.well-known/jmap responds (auth gate or capabilities)"
else
    fail "JMAP endpoint $issuer/.well-known/jmap returned an unexpected body — endpoint may be misrouted"
fi

echo
ok "all checks passed — Iarsma $version is serving correctly at $BASE_URL/"
