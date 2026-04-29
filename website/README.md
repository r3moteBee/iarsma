# iarsma.io

Static landing page for [Iarsma](https://github.com/r3moteBee/iarsma).

Single `index.html`, no build step, no JavaScript. Inline CSS with `prefers-color-scheme` for dark mode.

## Deploying via GitHub Pages

1. Create a new public repo, e.g. `r3moteBee/iarsma.io`.
2. Copy `index.html`, `CNAME`, and (optionally) this README into it.
3. Repo → Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/`.
4. At your DNS provider, point `iarsma.io` to GitHub Pages:
   - Apex (`iarsma.io`): four A records →
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `www` (optional): CNAME → `r3motebee.github.io`
5. Back in Pages settings, check **Enforce HTTPS** once the cert provisions (5–15 min).

The `CNAME` file is what tells Pages which custom domain to serve — don't delete it.

## Updating

Edit `index.html`, push to `main`. Pages redeploys in ~30 seconds.

## Why a separate repo

Marketing copy changes more often than the codebase, and Pages picks up the apex domain cleanly when the site lives in its own repo. If we ever switch to Cloudflare Pages or a static host with a build step, the move is a one-line DNS change.
