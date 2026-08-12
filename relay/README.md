# api-sports static-egress relay

api-sports rate-limit **per source IP** as well as per API key, and they confirmed (2026-08-12) they
cannot whitelist or key-scope a shared address:

> Unfortunately, we cannot whitelist a shared Cloudflare IP or apply the protection to your API key
> only. For reliable production use in a production environment, we recommend routing your requests
> through infrastructure with a dedicated/static outbound IP address.

Cloudflare Workers egress from IPs shared with every other tenant, so our near-idle Ultra key kept
meeting a per-minute limit that other people's traffic had filled. This relay is the dedicated IP:

    app → Worker (cache) → relay (fixed IP) → api-sports

The Worker keeps all caching (edge + Supabase), so the relay only sees genuine cache misses — a few
requests a minute even at launch traffic. Any box with a static IPv4 will do; the cheapest tier at
Hetzner / DigitalOcean / Fly.io (dedicated IP) / Oracle free tier is more than enough.

**The relay is an optimisation, never a dependency.** With `RELAY_URL` unset the Worker calls
api-sports directly, exactly as before, and if the relay is ever down or unreachable the Worker
falls back to the direct call on that request. Losing the box degrades us to today's behaviour; it
cannot take the app down.

## Setup

**1. On the box** (Ubuntu, as root):

```bash
apt update && apt install -y nodejs caddy
mkdir -p /opt/relay && cd /opt/relay
# copy server.mjs here (scp, or paste it)

cat >/etc/systemd/system/relay.service <<'EOF'
[Unit]
Description=api-sports static egress relay
After=network.target

[Service]
Environment=APISPORTS_KEY=<your api-sports key>
Environment=RELAY_SECRET=<a long random string>
Environment=PORT=8080
ExecStart=/usr/bin/node /opt/relay/server.mjs
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now relay
curl localhost:8080/healthz    # {"ok":true}
```

**2. TLS** — the Worker must reach it over HTTPS. Point a subdomain (e.g. `relay.yourdomain.com`)
at the box's IP, then:

```bash
cat >/etc/caddy/Caddyfile <<'EOF'
relay.yourdomain.com {
  reverse_proxy localhost:8080
}
EOF
systemctl restart caddy
```

Caddy gets the certificate automatically. Verify from anywhere:
`curl https://relay.yourdomain.com/healthz`

**3. Point the Worker at it** — no code change, just secrets:

```bash
cd /path/to/matchours
echo -n 'https://relay.yourdomain.com/v3' | npx wrangler secret put RELAY_URL
echo -n '<the same RELAY_SECRET>'        | npx wrangler secret put RELAY_SECRET
```

Note the `/v3` suffix on `RELAY_URL`: the relay maps `/v3/*` to the football API (and
`/basketball/*`, `/volleyball/*` to the other two hosts).

**4. Verify** the throttled query shapes now work — these are the ones that fail from Workers'
shared egress:

```bash
curl -s "https://your-app-domain/api/football?mode=venue&name=Kenilworth%20Road&teamId=1359"
```

A fixture in the response means the relay is doing its job. To roll back, delete the `RELAY_URL`
secret; the Worker returns to direct calls immediately.

## Notes

- Only `GET` on the three sports prefixes is forwarded, so a leaked secret cannot make this an open
  proxy.
- A 150ms FIFO gate keeps our own IP under the plan's 7 req/s — a cold cache after a deploy could
  otherwise burst from this box and recreate the problem it exists to solve.
- The API key lives only on the relay and in the Worker's secrets — never in the app bundle.
