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

# ── 3. config.json (operator-supplied; OPTIONAL when same-origin) ─
# A real config.json is JSON. A 200 response with a JSON body that has
# the required fields is the explicit-override case. A 200 response
# whose body is the SPA fallback (HTML) means no config.json was
# uploaded — the bundle relies on same-origin defaults
# (`tryLoadFromSameOrigin` in shell/src/config.ts), which only need
# `window.location.origin == oidcIssuer`. We compute the deploy origin
# here for the CORS check below either way.
deploy_origin="$(printf '%s' "$BASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"

config_body="$(curl -sS -w "\n%{http_code}" "$BASE_URL/config.json" || true)"
config_status="${config_body##*$'\n'}"
config_json="${config_body%$'\n'*}"
issuer=""
redirect=""
if [[ "$config_status" == "200" ]] && jq -e '.oidcIssuer' >/dev/null 2>&1 <<<"$config_json"; then
    # Explicit config.json present and well-formed.
    for field in oidcIssuer clientId redirectUri; do
        if ! jq -e ".${field}" >/dev/null 2>&1 <<<"$config_json"; then
            fail "config.json missing required field: $field"
        fi
    done
    issuer="$(jq -r '.oidcIssuer' <<<"$config_json")"
    client="$(jq -r '.clientId' <<<"$config_json")"
    redirect="$(jq -r '.redirectUri' <<<"$config_json")"
    ok "config.json present (explicit override): oidcIssuer=$issuer, clientId=$client"
else
    # No real config.json — same-origin defaults will apply at runtime.
    # The bundle derives oidcIssuer from window.location.origin and
    # redirectUri from `${origin}${BASE_URL}auth/callback`. We can
    # reproduce the issuer side of that here for the downstream checks.
    issuer="$deploy_origin"
    redirect="${BASE_URL%/}/auth/callback"
    ok "no config.json — using same-origin defaults (issuer=$issuer)"
fi

# ── 4. redirectUri sanity ─────────────────────────────────────────
if [[ "$redirect" != https://* ]] && [[ "$redirect" != http://localhost* ]] && [[ "$redirect" != http://127.0.0.1* ]]; then
    fail "redirectUri must be HTTPS (Stalwart's policy) or http://localhost(:port) for dev: $redirect"
fi
ok "redirectUri scheme acceptable: $redirect"

# ── 5. OIDC discovery + CORS ──────────────────────────────────────
oidc_url="$issuer/.well-known/openid-configuration"
discovery="$(curl -sS -H "Origin: $deploy_origin" -i "$oidc_url" || true)"
if ! grep -qiE '^HTTP/[0-9.]+ 200' <<<"$discovery"; then
    fail "GET $oidc_url did not return 200 — issuer unreachable or wrong"
fi
allowed_origin="$(grep -i '^access-control-allow-origin:' <<<"$discovery" | tr -d '\r' | sed 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:[[:space:]]*//')"
# Same-origin deploys (deploy origin == issuer origin) don't need a
# CORS allow-origin header at all — the browser bypasses CORS for
# same-origin requests. Only enforce the check when the deploy origin
# differs from the issuer origin.
issuer_origin="$(printf '%s' "$issuer" | sed -E 's#^(https?://[^/]+).*#\1#')"
if [[ "$deploy_origin" == "$issuer_origin" ]]; then
    ok "OIDC discovery reachable; same-origin (no CORS needed)"
elif [[ -z "$allowed_origin" ]]; then
    fail "OIDC discovery response carries no access-control-allow-origin — Stalwart's HTTP→General→Custom Response Headers needs configuring"
elif [[ "$allowed_origin" != "*" && "$allowed_origin" != "$deploy_origin" ]]; then
    fail "OIDC discovery sends access-control-allow-origin: $allowed_origin — does not match deploy origin $deploy_origin"
else
    ok "OIDC discovery + CORS reachable from $deploy_origin"
fi

# ── 6. JMAP endpoint reachability ─────────────────────────────────
# We just want to confirm the endpoint exists. Stalwart's behavior
# varies by version — some return 307 → /jmap/session, others return
# 401 unauthorized, others return the capabilities document. Any
# 2xx/3xx/401/403 says the endpoint is wired up; only 404/5xx mean
# a real misrouting.
jmap_status="$(curl -sS -o /dev/null -w "%{http_code}" "$issuer/.well-known/jmap" || echo 0)"
case "$jmap_status" in
    2*|3*|401|403)
        ok "JMAP endpoint reachable at $issuer/.well-known/jmap (HTTP $jmap_status)"
        ;;
    *)
        fail "JMAP endpoint $issuer/.well-known/jmap returned HTTP $jmap_status — endpoint may be misrouted"
        ;;
esac

echo
ok "all checks passed — Iarsma $version is serving correctly at $BASE_URL/"
