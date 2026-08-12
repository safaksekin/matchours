// Static-egress relay for api-sports.
//
// WHY THIS EXISTS. api-sports rate-limit per SOURCE IP on top of the API key, and they confirmed
// (2026-08-12) they cannot whitelist or key-scope a shared address: "for reliable production use,
// route your requests through infrastructure with a dedicated/static outbound IP." Cloudflare
// Workers egress from a pool shared with every other tenant, so our nearly-idle Ultra key kept
// being refused against a limit other people had filled. This box IS that dedicated IP: the Worker
// asks the relay, the relay asks api-sports, and the only traffic on our IP is ours.
//
// It is deliberately tiny — no dependencies, no state, no cache. Caching stays in the Worker
// (edge + Supabase), which already absorbs the user-facing load; the relay only sees what actually
// misses those layers, which is a few requests a minute even at launch traffic.
//
// RUN
//   APISPORTS_KEY=xxx RELAY_SECRET=yyy node server.mjs        # listens on :8080
// See README.md for the systemd unit + Caddy TLS setup.

import http from "node:http";

const KEY = process.env.APISPORTS_KEY || "";
const SECRET = process.env.RELAY_SECRET || "";
const PORT = parseInt(process.env.PORT || "8080", 10);
if (!KEY || !SECRET) { console.error("APISPORTS_KEY and RELAY_SECRET are required"); process.exit(1); }

// Only the sports hosts, only GET, only paths — so a leaked secret can't turn this into an open
// proxy for anything else on the internet.
const HOSTS = {
  "/v3": "https://v3.football.api-sports.io",
  "/basketball": "https://v1.basketball.api-sports.io",
  "/volleyball": "https://v1.volleyball.api-sports.io",
};

// Keep our own IP under the plan's 7 req/s: a tiny FIFO gate. The Worker's caching means we rarely
// approach it, but a cold cache after a deploy can burst — and a burst from THIS box would recreate
// the very problem the box exists to solve.
const MIN_GAP_MS = 150;
let last = 0, chain = Promise.resolve();
function gate() {
  chain = chain.then(async () => {
    const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  });
  return chain;
}

http.createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  try {
    if (req.url === "/healthz") return send(200, JSON.stringify({ ok: true }));
    if (req.method !== "GET") return send(405, JSON.stringify({ error: "method" }));
    if (req.headers["x-relay-key"] !== SECRET) return send(403, JSON.stringify({ error: "forbidden" }));

    const prefix = Object.keys(HOSTS).find((p) => req.url === p || req.url.startsWith(p + "/"));
    if (!prefix) return send(404, JSON.stringify({ error: "unknown path" }));

    await gate();
    const target = HOSTS[prefix] + req.url.slice(prefix.length);
    const up = await fetch(target, { headers: { "x-apisports-key": KEY } });
    const text = await up.text();
    // Pass the upstream status through untouched: the Worker's retry/backoff logic reads it.
    res.writeHead(up.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(text);
  } catch (e) {
    send(502, JSON.stringify({ error: "relay", detail: String(e) }));
  }
}).listen(PORT, () => console.log("relay listening on :" + PORT));
