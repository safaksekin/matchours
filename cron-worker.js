// Cron shell around the OpenNext worker.
//
// OpenNext's generated entry (.open-next/worker.js) only exports `fetch`; a Workers cron trigger
// needs a `scheduled` export on the SAME worker. This file is that: it passes requests straight
// through to the generated handler (and re-exports its Durable Object classes, which wrangler
// resolves by name from the entry module), and adds the one scheduled job we have — prewarming
// finished priority-league fixtures into the Supabase L2 cache so no user ever pays the cold
// five-round-trip detail assembly (see route.js `mode=prewarm` for the why and the batch rules).
//
// The job calls the route's own fetch handler DIRECTLY with a synthetic Request rather than
// fetching our public hostname. A cron self-fetch has to leave the worker, resolve DNS, terminate
// TLS and loop back through the edge to reach the very isolate that sent it — and on this zone it
// silently produced nothing (ten minutes of ticks, zero warmed fixtures, while the same request by
// hand worked). Calling the handler in-process removes every one of those moving parts: same code
// path, same caches, no network, and nothing to misconfigure. The secret header still rides along,
// so the route's guard is unchanged and a stranger still cannot spend our upstream quota.
// `waitUntil` keeps the invocation alive while the warm-through runs; the schedule itself lives in
// wrangler.jsonc (`triggers.crons`).
import handler from "./.open-next/worker.js";
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const SITE = "https://xn--fikstr-7ya.com"; // fikstür.com (punycode) — the Host the route is served on

export default {
  fetch: (request, env, ctx) => handler.fetch(request, env, ctx),
  async scheduled(controller, env, ctx) {
    const req = new Request(SITE + "/api/football?mode=prewarm&limit=8", {
      headers: { "x-warm-secret": env.FAN_ANALYSIS_SECRET || "" },
    });
    ctx.waitUntil(
      handler.fetch(req, env, ctx)
        .then((r) => r.text())
        .then((t) => console.log("prewarm:", t.slice(0, 300)))
        .catch((e) => console.log("prewarm failed:", String(e)))
    );
  },
};
