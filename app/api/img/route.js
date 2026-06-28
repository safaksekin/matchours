// app/api/img/route.js — same-origin image proxy for news thumbnails.
// Some news CDNs block cross-site <img> embedding (they check Sec-Fetch-Site, which
// Chrome sends and Safari doesn't). Fetching server-side and re-serving from our own
// origin sidesteps that, so images load in every browser. Edge-cached 24h. Host-allowlisted.

const ALLOW = /(^|\.)(tmgrup\.com\.tr|sozcucdn\.com)$/i;

export async function GET(request) {
  const u = new URL(request.url).searchParams.get("u");
  if (!u) return new Response("missing url", { status: 400 });
  let host;
  try { host = new URL(u).hostname; } catch (e) { return new Response("bad url", { status: 400 }); }
  if (!ALLOW.test(host)) return new Response("forbidden host", { status: 403 });

  const edge = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  const key = edge ? new Request("https://img.cache.local/" + encodeURIComponent(u), { method: "GET" }) : null;
  if (edge) {
    try { const hit = await edge.match(key); if (hit) return hit; } catch (e) {}
  }

  let upstream;
  try {
    upstream = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; fikstur/1.0)", "Accept": "image/*,*/*" } });
  } catch (e) { return new Response("fetch error", { status: 502 }); }
  if (!upstream.ok) return new Response("upstream " + upstream.status, { status: 502 });

  const ct = upstream.headers.get("content-type") || "image/jpeg";
  if (ct.indexOf("image") !== 0) return new Response("not an image", { status: 415 });
  const buf = await upstream.arrayBuffer();
  const res = new Response(buf, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" } });
  if (edge) { try { await edge.put(key, res.clone()); } catch (e) {} }
  return res;
}
