<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Cloudflare Browser Cache TTL — RESOLVED 2026-08-02

The fikstür.com zone is now set to **Caching → Configuration → Browser Cache TTL → "Respect Existing
Headers"**, so `jsonCached()`'s `max-age=0, must-revalidate` survives to the client. Verified against
`/api/football?mode=list` on 2026-08-02: a `cf-cache-status: HIT` response returned
`cache-control: public, max-age=0, must-revalidate, s-maxage=30, stale-while-revalidate=120` — the
old `max-age=14400` rewrite is gone, and live scores can no longer go four hours stale on a phone.

Leftover: the native app's 30-second bucketed cache-buster (`bustedURL` in fikstür-app's
`lib/football.js`) is redundant now. Harmless to leave, fine to remove.

**Still true:** do not "fix" cache headers in the route. The origin header is correct as written.
