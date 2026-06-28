// app/api/news/route.js — Turkish football headlines WITH images, merged from a few
// public RSS feeds (each exposes its own article image via <enclosure>/<media:content>).
// No scraper / no cron: fetched on demand, cached ~3h at the Cloudflare edge.
// Returns { news: [{ title, link, image, source, date }] }.

const FEEDS = [
  { url: "https://www.aspor.com.tr/rss/futbol.xml", source: "A Spor" },
  { url: "https://www.sabah.com.tr/rss/spor.xml", source: "Sabah" },
  { url: "https://www.sozcu.com.tr/feeds-rss-category-spor", source: "Sözcü" },
];

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/<[^>]+>/g, "")
    .trim();
}
function tag(block, name) {
  const m = new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">").exec(block);
  return m ? decode(m[1]) : "";
}
function imgOf(block) {
  const m = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(block)
    || /<media:content[^>]+url=["']([^"']+)["']/i.exec(block)
    || /<media:thumbnail[^>]+url=["']([^"']+)["']/i.exec(block)
    || /<img[^>]+src=["']([^"']+)["']/i.exec(block);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}
function parseFeed(xml, source) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && out.length < 30) {
    const b = m[1];
    const title = tag(b, "title");
    const link = tag(b, "link");
    if (!title || !link) continue;
    out.push({ title: title, link: link, image: imgOf(b), date: tag(b, "pubDate"), source: source });
  }
  return out;
}

export async function GET() {
  const edge = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  const key = edge ? new Request("https://news.cache.local/tr-football-v2", { method: "GET" }) : null;
  if (edge) {
    try { const hit = await edge.match(key); if (hit) return new Response(await hit.text(), { headers: { "Content-Type": "application/json" } }); } catch (e) {}
  }

  const results = await Promise.all(FEEDS.map(async function (f) {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; fikstur/1.0)" } });
      if (!r.ok) return [];
      return parseFeed(await r.text(), f.source);
    } catch (e) { return []; }
  }));

  const all = [];
  results.forEach(function (arr) { arr.forEach(function (n) { all.push(n); }); });
  // dedupe by normalized title
  const seen = {};
  const merged = [];
  all.forEach(function (n) {
    const k = n.title.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (!seen[k]) { seen[k] = 1; merged.push(n); }
  });
  // newest first
  merged.sort(function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); });
  const news = merged.slice(0, 30);

  const body = JSON.stringify({ news: news });
  if (edge) {
    try { await edge.put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10800" } })); } catch (e) {}
  }
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=10800" } });
}
