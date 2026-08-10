// app/api/football/route.js
// API-Football (api-sports.io) — direct access.
// .env.local:  APISPORTS_KEY=your_api_key_here

import { POP_TEAMS, POP_PLAYERS, popRank, popOf } from "../../lib/popular";

const HOST = "https://v3.football.api-sports.io";

// Short display names for the leagues the UI is laid out around — nothing more.
//
// This used to be a WHITELIST with a pinned `season` per league, and both halves were bugs waiting
// to fire. The whitelist hid every league it had never heard of, which for an app whose job is
// checking people in at grounds is backwards: an amateur division is exactly the fixture that must
// not be missing. And a pinned `season: 2025` does not fail loudly — it keeps answering 200 with
// last season's finished fixtures and no upcoming ones, so the feed quietly empties the day that
// season ends. In July 2026 every European league here was still being asked for 2025/26.
//
// Both are gone: fixtures are fetched BY DATE (a date needs no season and belongs to no whitelist)
// and this map only overrides the name where we prefer a shorter one.
const LEAGUE_NAMES = {
  1: "World Cup",
  2: "Champions League",
  3: "Europa League",
  848: "Conference League",
  39: "Premier League",
  140: "La Liga",
  135: "Serie A",
  78: "Bundesliga",
  61: "Ligue 1",
  203: "Super Lig",
  292: "K League 1",
  169: "Çin Süper Lig",
  113: "Allsvenskan",
  244: "Veikkausliiga",
  116: "Belarus Premier",
  103: "Eliteserien",
};

function hdr() { return { "x-apisports-key": process.env.APISPORTS_KEY || "" }; }

function clampInt(v, lo, hi) {
  const n = parseInt(v || "", 10);
  if (isNaN(n)) return 0;
  return Math.max(lo, Math.min(hi, n));
}

// The leagues a trimmed feed is REQUIRED to carry (`mode=list&tier=priority`), in the user's own
// order. Deliberately a duplicate of LEAGUE_PRIORITY in the app's lib/football.js: the app applies
// the same rule to whatever it receives, so it still behaves correctly against an older deploy of
// this route — but the two lists must be edited together or the trim here will hide fixtures the app
// would have ranked to the top. Not the same thing as LEAGUE_NAMES (display) or LEAGUE_TIER (depth).
const PRIORITY_LEAGUES = [
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  848, // UEFA Europa Conference League
  39,  // Premier League
  78,  // Bundesliga
  140, // La Liga
  135, // Serie A
  61,  // Ligue 1
  203, // Süper Lig
  88,  // Eredivisie
  144, // Jupiler Pro League
  40,  // Championship
  79,  // 2. Bundesliga
  204, // TFF 1. Lig
  205, // TFF 2. Lig
];
const PRIORITY_RANK = {};
PRIORITY_LEAGUES.forEach(function (id, i) { PRIORITY_RANK[id] = i; });

// Curated tier order (lower = higher division) so league trees read top-down by level,
// e.g. England: Premier League -> Championship -> League One; Turkey: Super Lig -> 1. Lig.
const LEAGUE_TIER = {
  1: 1,                                   // World Cup
  39: 1, 40: 2, 41: 3, 42: 4, 43: 5,      // England
  140: 1, 141: 2, 142: 3,                 // Spain
  135: 1, 136: 2,                         // Italy
  78: 1, 79: 2, 80: 3,                    // Germany
  61: 1, 62: 2, 63: 3,                    // France
  203: 1, 204: 2, 205: 3,                 // Turkey
  88: 1, 89: 2,                           // Netherlands
  94: 1, 95: 2,                           // Portugal
  144: 1, 145: 2,                         // Belgium
  179: 1, 180: 2,                         // Scotland
};
function leagueTierKey(l) {
  var p = LEAGUE_TIER[l.id];
  if (p != null) return p;             // curated top divisions: 1..N
  if (l.type === "League") return 400; // other domestic leagues
  return 800;                          // cups / everything else
}

// Cache successful API-Football responses at the Cloudflare edge (keyed by URL) so repeated
// navigation doesn't re-hit api-sports and blow the rate limit. Only 200s are cached.
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// In-memory fallback used when the Cloudflare edge cache isn't available — chiefly `npm run dev`
// (Node has no `caches.default`) and React's dev double-render. Stops the dev server from re-hitting
// api-sports on every refresh / effect re-run, which is what burns the quota while building.
const memCache = new Map(); // url -> { exp, data }
function memGet(url) {
  const hit = memCache.get(url);
  if (hit && hit.exp > Date.now()) return hit.data;
  if (hit) memCache.delete(url);
  return undefined; // miss (cached responses are only ever stored when truthy)
}
function memSet(url, data, ttl) {
  if (memCache.size > 600) memCache.delete(memCache.keys().next().value); // simple LRU-ish cap
  memCache.set(url, { exp: Date.now() + ttl * 1000, data: data });
}

// ── Persistent L2 cache in Supabase (api_cache table) ──────────────────────
// Only long-TTL (immutable-ish) responses are stored here, so finished matches /
// past seasons / player match stats survive edge eviction AND dev restarts:
// once anyone fetches them, every later read is 0 API calls. Reads/writes use the
// SERVICE ROLE key (server-only); if it's not configured the layer just no-ops.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SB_ON = !!(SB_URL && SB_KEY);
const PERSIST_TTL = 86400; // TTL >= 1 day => back the response with Supabase
function sbHdr() { return { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }; }

async function sbCacheGet(path) {
  if (!SB_ON) return undefined;
  try {
    const u = SB_URL + "/rest/v1/api_cache?key=eq." + encodeURIComponent(path) + "&select=payload,expires_at";
    const r = await fetch(u, { headers: sbHdr() });
    if (!r.ok) return undefined;
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row) return undefined;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return undefined; // stale
    return row.payload;
  } catch (e) { return undefined; }
}

async function sbCacheSet(path, payload, ttl) {
  if (!SB_ON) return;
  try {
    const expires = ttl >= 31536000 ? null : new Date(Date.now() + ttl * 1000).toISOString(); // >=1y => never expires
    const u = SB_URL + "/rest/v1/api_cache?on_conflict=key";
    await fetch(u, {
      method: "POST",
      headers: Object.assign(sbHdr(), { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: path, payload: payload, expires_at: expires }),
    });
  } catch (e) { /* cache write is best-effort */ }
}

async function apiGet(path, revalidate, _retried) {
  const ttl = revalidate || 60;
  const url = HOST + path;
  const persist = ttl >= PERSIST_TTL; // immutable-ish -> also back it with Supabase
  const edge = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  const key = edge ? new Request(url, { method: "GET" }) : null;
  if (!edge) { const m = memGet(url); if (m !== undefined) return m; } // dev L1 (RAM) hit
  try {
    if (edge) {
      const hit = await edge.match(key);
      if (hit) { const j = JSON.parse(await hit.text()); return j && j.response ? j.response : null; }
    }
    // L2: Supabase (persistent) — only on L1 miss, only for immutable data
    if (persist) {
      const sb = await sbCacheGet(path);
      if (sb !== undefined && sb !== null) {
        // warm L1 so repeat reads in this colo/instance skip Supabase too
        if (edge) { try { await edge.put(key, new Response(JSON.stringify({ response: sb }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + ttl } })); } catch (e) {} }
        else memSet(url, sb, ttl);
        return sb;
      }
    }
    const res = await fetch(url, { headers: hdr() });
    if (!res.ok) {
      // rate-limited / transient -> wait briefly and retry once (limits are per-second)
      if (!_retried && (res.status === 429 || res.status >= 500)) { await sleep(900); return apiGet(path, revalidate, true); }
      return null;
    }
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) { return null; }
    const errs = j && j.errors;
    const hasErr = errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
    if (hasErr) {
      if (!_retried) { await sleep(900); return apiGet(path, revalidate, true); } // retry rate-limited once
      return null;
    }
    const resp = (j && j.response) ? j.response : null;
    if (resp) {
      if (edge) {
        await edge.put(key, new Response(text, {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + ttl },
        }));
      } else {
        memSet(url, resp, ttl); // dev / no-edge: remember in RAM so refreshes don't re-hit the API
      }
      if (persist) await sbCacheSet(path, resp, ttl); // immutable data -> persist across colos + dev restarts
    }
    return resp;
  } catch (e) { return null; }
}

// ── Our own search index (Supabase) ────────────────────────────────────────
// Typeahead is answered from `search_entities` / `search_all()`, NOT from
// API-Football's `?search=`. That upstream parameter needs >= 3 characters,
// compares raw diacritic-sensitive substrings ("eyup" never matches "Eyüpspor",
// "yildiz" never matches "Kenan Yıldız") and has no ranking at all, so "mil"
// answers Millwall before AC Milan. None of that is fixable from out here.
// See supabase/migrate-search-index.sql + scripts/seed-search.mjs.
async function searchIndex(q, perKind) {
  if (!SB_ON) return null;
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/search_all", {
      method: "POST",
      headers: sbHdr(),
      body: JSON.stringify({ q: q, per_kind: perKind || 6 }),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    const out = { teams: [], players: [], venues: [], leagues: [] };
    for (const row of rows) {
      if (row.kind === "team") out.teams.push(row);
      else if (row.kind === "player") out.players.push(row);
      else if (row.kind === "venue") out.venues.push(row);
      else out.leagues.push(row);
    }
    return out;
  } catch (e) { return null; }
}

// Is the index populated? Answers whether we may rely on it, so a deploy that
// lands BEFORE the seeder has run keeps working on the legacy API-Football path
// instead of returning an empty search box. Cached, so it costs one query per
// worker instance per 10 minutes — not one per search.
let _indexReady = { at: 0, ok: false };
async function indexReady() {
  if (!SB_ON) return false;
  if (Date.now() - _indexReady.at < 600000) return _indexReady.ok;
  try {
    const r = await fetch(SB_URL + "/rest/v1/search_entities?select=ext_id&kind=eq.team&limit=1", { headers: sbHdr() });
    const rows = r.ok ? await r.json() : null;
    _indexReady = { at: Date.now(), ok: !!(rows && rows.length) };
  } catch (e) {
    _indexReady = { at: Date.now(), ok: false };
  }
  return _indexReady.ok;
}

// index row -> the shapes both clients already render
function idxTeam(r) {
  return { id: r.ext_id, name: r.name, logo: r.image || null, country: r.country || r.subtitle || null };
}
function idxPlayer(r) {
  const m = r.meta || {};
  return {
    id: r.ext_id,
    name: r.name,
    photo: r.image || null,
    age: m.age != null ? m.age : null,
    nationality: r.country || null,
    position: m.position || null,
    team: r.subtitle || null,   // the club — what actually tells two namesakes apart
    teamId: m.teamId != null ? m.teamId : null,
  };
}

// API-Football's search field rejects non-ASCII (Turkish ı/ü/ş... -> error), so fold first.
function asciiFold(s) {
  if (!s) return "";
  const map = { "ı": "i", "İ": "I", "ş": "s", "Ş": "S", "ğ": "g", "Ğ": "G", "ü": "u", "Ü": "U", "ö": "o", "Ö": "O", "ç": "c", "Ç": "C" };
  let out = s.replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (ch) { return map[ch] || ch; });
  return out.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), ""); // strip remaining accents (é -> e)
}
function searchSafe(s) {
  return asciiFold(s).replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Everything that is not clearly in play or clearly over used to collapse into "upcoming", which put
// postponed and cancelled fixtures in the same bucket as tonight's kick-offs — and there they stayed
// forever, since a postponed match never gets a score to move it on.
//   PST postponed · CANC cancelled · ABD abandoned  -> it is not going to be played at this time
//   AWD awarded  · WO walkover                      -> decided, just not on the pitch
//   SUSP suspended                                  -> halted mid-match, may resume: still live
function statusOf(short) {
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"].includes(short)) return "live";
  if (["FT", "AET", "PEN", "AWD", "WO"].includes(short)) return "finished";
  if (["PST", "CANC", "ABD"].includes(short)) return "postponed";
  return "upcoming";
}

function ymd(d) {
  var m = ("0" + (d.getMonth() + 1)).slice(-2);
  var day = ("0" + d.getDate()).slice(-2);
  return d.getFullYear() + "-" + m + "-" + day;
}

// Cache OUR OWN response at the edge, not just the api-sports calls behind it.
//
// apiGet() caches upstream; without this the Worker still woke up for every single request, re-mapped
// the whole fixture set and re-serialised it — 600 KB of JSON built from scratch on a full cache hit.
// With s-maxage, Cloudflare answers from the colo and the Worker is never invoked.
// stale-while-revalidate lets it keep serving the old copy while it refreshes in the background, so
// nobody ever waits for the refill. Private caches are excluded: a shared answer is fine in a
// datacentre, but a user's phone should keep using its own status-aware TTLs.
//
// `max-age=0` is now stated OUTRIGHT rather than left unset. Omitting it does not mean "no private
// caching" — it means Cloudflare fills the gap with its Browser Cache TTL, and the zone's is four
// hours, so this route was answering `public, max-age=14400, s-maxage=30`. iOS NSURLCache honours
// max-age, so the app's 60-second poll of the live feed could legitimately be served a four-hour-old
// score by the phone itself, without a request ever leaving the device.
function jsonCached(body, sMaxAge, swr) {
  return Response.json(body, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate, s-maxage=" + sMaxAge + ", stale-while-revalidate=" + (swr || sMaxAge * 4),
    },
  });
}

// A response nobody may keep. For upstream failures: an error cached is an error that outlives its
// cause, and the long-TTL branches below (a settled date caches for a day) would do exactly that.
function jsonNoStore(body, status) {
  return Response.json(body, { status: status || 200, headers: { "Cache-Control": "no-store" } });
}

function mapFixture(item, leagueName) {
  const fx = item.fixture;
  const d = new Date(fx.date);
  const goals = item.goals || {};
  const hasScore = goals.home != null && goals.away != null;
  const short = fx.status && fx.status.short;
  return {
    id: String(fx.id),
    homeId: item.teams.home.id,
    awayId: item.teams.away.id,
    home: item.teams.home.name,
    away: item.teams.away.name,
    homeLogo: item.teams.home.logo,
    awayLogo: item.teams.away.logo,
    time: d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }),
    date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul" }),
    league: leagueName || (item.league && item.league.name) || "",
    leagueId: item.league && item.league.id,
    season: item.league && item.league.season,
    round: (item.league && item.league.round) || null,
    status: statusOf(short),
    // the raw API short (1H/HT/2H/ET/BT/P/…): `status` collapses every in-play state to "live",
    // but the interval, extra time and a shootout each need their own clock label client-side
    statusShort: short || null,
    dateKey: d.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }), ts: d.getTime(),
    minute: (fx.status && fx.status.elapsed) || null,
    score: hasScore ? (goals.home + " - " + goals.away) : null,
    penScore: (function(){ var p = item.score && item.score.penalty; return (p && p.home != null && p.away != null) ? (p.home + " - " + p.away) : null; })(),
    // Only the three fields a fixture actually carries. The form/rank/squad/channel/h2h keys used to
    // be emitted here as empty arrays and nulls — they are filled by mode=detail, never by a fixture
    // list, so in a 864-match response they were ~250 KB of nothing repeated 864 times. The web
    // already defaults every one of them (Home.jsx: `Object.assign({channels:[], homeSquad:[], ...},
    // match.stats)`), so dropping them changes no behaviour, only the size.
    stats: {
      referee: fx.referee || "—",
      stadium: (fx.venue && fx.venue.name) || "—",
      city: (fx.venue && fx.venue.city) || "—",
    },
  };
}

// Resolve a team's CURRENT-OR-NEXT HOME fixture (raw item) + its venue id/image by EXACT API-Football
// team id. A LIVE home fixture always wins (short TTL, re-checked often) so a match that's already kicked
// off keeps being returned here instead of falling out of `next=1` (which only sees not-started fixtures)
// and getting replaced by whatever's scheduled after it. Only once the live match actually finishes does
// this fall through to the normal NS lookup. PRIMARY the venue filter, FALLBACK the team's next home game.
// All via apiGet, so it's edge/Supabase cached and rate-limit-retried. Shared by mode=venue (teamId path)
// and the mode=nearby batch.
async function venueNextByTeamId(teamId) {
  const td = await apiGet("/teams?id=" + encodeURIComponent(teamId), 86400);
  const e = td && td[0];
  if (!e) return { venueId: null, image: null, item: null };
  const tid = (e.team && e.team.id) || parseInt(teamId, 10) || null;
  const vn = e.venue || {};
  const venueId = vn.id || null;
  let item = null;
  if (tid) {
    const live = await apiGet("/fixtures?team=" + tid + "&live=all", 20);
    item = (live || []).find(function (f) { return f.teams && f.teams.home && String(f.teams.home.id) === String(tid); }) || null;
  }
  if (!item && venueId) {
    const byVenue = await apiGet("/fixtures?venue=" + venueId + "&next=1", 900);
    if (byVenue && byVenue.length) item = byVenue[0];
  }
  if (!item && tid) {
    const fx = await apiGet("/fixtures?team=" + tid + "&next=10", 900);
    const homeGames = (fx || []).filter(function (f) { return f.teams && f.teams.home && String(f.teams.home.id) === String(tid); });
    const atVenue = homeGames.filter(function (f) { return venueId && f.fixture && f.fixture.venue && String(f.fixture.venue.id) === String(venueId); });
    item = atVenue[0] || homeGames[0] || null;
  }
  return { venueId: venueId, image: vn.image || null, item: item };
}

// A Worker's own response is NOT cached by the CDN just because it carries Cache-Control. The edge
// cache sits in FRONT of the Worker and, for a dynamic route, is never consulted — the header alone
// only ever talked to intermediaries that aren't there. So the Worker has to do the storing itself,
// with the same Cache API apiGet() already uses for upstream calls.
//
// Only responses that asked to be shared (jsonCached sets s-maxage) are stored; the TTL in the header
// is what Cloudflare then honours, so each mode keeps the lifetime it declared.
export async function GET(request) {
  const edge = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  if (!edge) return handle(request);
  const key = new Request(request.url, { method: "GET" });
  try {
    const hit = await edge.match(key);
    if (hit) return hit;
  } catch (e) { /* a cache read must never take the request down with it */ }
  const res = await handle(request);
  const cc = res.headers.get("Cache-Control") || "";
  if (res.status === 200 && cc.indexOf("s-maxage") >= 0) {
    try { await edge.put(key, res.clone()); } catch (e) {}
  }
  return res;
}

async function handle(request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "list";

  if (!process.env.APISPORTS_KEY) return Response.json({ error: "no_key", matches: [] });

  // ── Other sports: match names only (basketball / volleyball / mma / nba) ──
  if (mode === "othersport") {
    const sport = searchParams.get("sport");
    const SPORTS = {
      basketball: { host: "https://v1.basketball.api-sports.io", path: "/games" },
      volleyball: { host: "https://v1.volleyball.api-sports.io", path: "/games" },
      nba:        { host: "https://v2.nba.api-sports.io",        path: "/games" },
      mma:        { host: "https://v1.mma.api-sports.io",        path: "/fights" },
    };
    const cfg = SPORTS[sport];
    if (!cfg) return Response.json({ matches: [] });

    const today = new Date();
    const dToday = today.toISOString().split("T")[0];

    function fmt(dateStr) {
      const d = new Date(dateStr);
      return {
        time: d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }),
        date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul" }),
      };
    }

    try {
      // games endpoints accept ?date=; mma fights we just take upcoming list
      const url = cfg.host + cfg.path + (sport === "mma" ? "?season=" + today.getFullYear() : "?date=" + dToday);
      // 45s so LIVE minutes/scores in the list (and the app's live-header fallback) stay fresh
      const res = await fetch(url, { headers: hdr(), next: { revalidate: 45 } });
      const j = await res.json();
      const resp = (j && j.response) ? j.response : [];
      const out = [];

      if (sport === "mma") {
        resp.slice(0, 30).forEach(function (f, i) {
          const fighters = f.fighters || {};
          const a = fighters.first || {};
          const b = fighters.second || {};
          const tm = fmt(f.date || (f.fixture && f.fixture.date) || today);
          out.push({
            id: "mma-" + (f.id || i),
            home: a.name || "?", away: b.name || "?",
            homeLogo: a.logo || null, awayLogo: b.logo || null,
            time: tm.time, date: tm.date,
            league: (f.category) || (f.slug) || "MMA",
            status: f.status && f.status.long && /(finished|over)/i.test(f.status.long) ? "finished" : "upcoming",
            score: null, minute: null, namesOnly: true,
          });
        });
      } else {
        resp.slice(0, 40).forEach(function (g, i) {
          const teams = g.teams || {};
          const h = teams.home || {};
          const a = teams.away || {};
          const dt = g.date || (g.date && g.date.start) || (g.fixture && g.fixture.date) || today;
          const tm = fmt(typeof dt === "string" ? dt : (dt.start || today));
          var st = "upcoming";
          var ss = (g.status && (g.status.short || g.status.long)) || "";
          if (/(finished|FT|AOT|Final)/i.test(ss)) st = "finished";
          else if (/(Q1|Q2|Q3|Q4|live|in play|HT|OT|set)/i.test(ss)) st = "live";
          out.push({
            id: sport + "-" + (g.id || i),
            home: h.name || "?", away: a.name || "?",
            homeLogo: h.logo || null, awayLogo: a.logo || null,
            time: tm.time, date: tm.date,
            league: (g.league && g.league.name) || (g.country && g.country.name) || "",
            status: st, score: null, minute: null, namesOnly: true,
          });
        });
      }
      return Response.json({ matches: out });
    } catch (e) {
      return Response.json({ matches: [] });
    }
  }

  // ── Search: teams · players · matches ──
  // Entities come from OUR index (one indexed Postgres query, no upstream call,
  // works from a single character). Only the MATCH list still needs
  // API-Football, and it is fetched by team id — never by text — so a fixture
  // lookup can no longer be wrecked by how the provider spells a club.
  if (mode === "search") {
    const qRaw = (searchParams.get("q") || "").trim();
    if (qRaw.length < 1) return Response.json({ teams: [], matches: [], players: [], venues: [] });

    if (await indexReady()) {
      const idx = await searchIndex(qRaw, 6);
      if (idx) {
        const teamsOut = idx.teams.map(idxTeam);
        let playersOut = idx.players.map(idxPlayer);
        const venuesOut = idx.venues.map(function (r) {
          return { id: r.ext_id, name: r.name, city: (r.meta && r.meta.city) || null, image: r.image || null, country: r.country || null };
        });

        // The index is built from CURRENT squads, so it deliberately does not carry
        // retired players — "zidane" and "pirlo" would return nothing, which the
        // old text-proxy search did handle. Ask upstream for exactly that case and
        // nothing else: only when the index found no player at all, only for a
        // query long enough to be a real surname, and cached for a day. Teams,
        // venues and leagues need no equivalent — those are indexed exhaustively.
        if (!playersOut.length) {
          const legacyQ = searchSafe(qRaw);
          if (legacyQ.length >= 4) {
            const profiles = await apiGet("/players/profiles?search=" + encodeURIComponent(legacyQ), 86400);
            playersOut = (profiles || [])
              .map(function (it) { return it.player || {}; })
              .filter(function (p) { return p.id; })
              .slice(0, 6)
              .map(function (p) {
                return {
                  id: p.id,
                  // prefer "Zinedine Zidane" over the abbreviated "Z. Zidane" the API returns in `name`
                  name: (p.firstname && p.lastname && p.firstname.length > 2 && p.firstname.indexOf(".") === -1)
                    ? (p.firstname + " " + p.lastname)
                    : (p.name || ((p.firstname || "") + " " + (p.lastname || "")).trim()),
                  photo: p.photo || null,
                  age: p.age != null ? p.age : null,
                  nationality: p.nationality || null,
                  position: p.position || null,
                  team: null,
                  teamId: null,
                };
              });
          }
        }

        // Head-to-head: "fenerbahce besiktas" should answer with the derby, not
        // with whichever half the ranker happened to like. Only accepted when
        // BOTH halves independently resolve to a well-known club, so ordinary
        // two-word queries ("arda guler") are unaffected.
        const toks = qRaw.split(/\s+/).filter(Boolean);
        let pair = null;
        if (toks.length >= 2 && toks.length <= 4) {
          const splits = [];
          for (let i = 1; i < toks.length; i++) splits.push([toks.slice(0, i).join(" "), toks.slice(i).join(" ")]);
          const probed = await Promise.all(
            splits.map(function (s) {
              return Promise.all([searchIndex(s[0], 1), searchIndex(s[1], 1)]);
            })
          );
          const solid = function (res) {
            const t = res && res.teams && res.teams[0];
            return t && t.score >= 150 && t.popularity >= 55 ? t : null;
          };
          for (const [ra, rb] of probed) {
            const a = solid(ra), b = solid(rb);
            if (a && b && a.ext_id !== b.ext_id) { pair = [a, b]; break; }
          }
        }

        const matchesOut = [];
        const seenFx = {};
        const pushFx = function (item) {
          if (!item || !item.fixture) return;
          const fid = String(item.fixture.id);
          if (seenFx[fid]) return;
          seenFx[fid] = true;
          matchesOut.push(mapFixture(item, item.league && item.league.name));
        };

        if (pair) {
          const h2h = pair[0].ext_id + "-" + pair[1].ext_id;
          const [nextH, lastH] = await Promise.all([
            apiGet("/fixtures/headtohead?h2h=" + h2h + "&next=5", 120),
            apiGet("/fixtures/headtohead?h2h=" + h2h + "&last=10", 300),
          ]);
          [].concat(nextH || [], lastH || []).forEach(pushFx);
          // put the two protagonists first, keep the rest of the ranking behind them
          const ids = [pair[0].ext_id, pair[1].ext_id];
          teamsOut.sort(function (a, b) { return ids.indexOf(b.id) - ids.indexOf(a.id); });
        } else if (teamsOut.length) {
          const top = teamsOut[0].id;
          const [up, re] = await Promise.all([
            apiGet("/fixtures?team=" + top + "&next=6", 120),
            apiGet("/fixtures?team=" + top + "&last=6", 300),
          ]);
          [].concat(up || [], re || []).forEach(pushFx);
        } else if (playersOut.length && playersOut[0].teamId) {
          // No team matched but a player did ("haaland") — show HIS club's fixtures,
          // which is the match list the user actually wanted.
          const [up, re] = await Promise.all([
            apiGet("/fixtures?team=" + playersOut[0].teamId + "&next=4", 120),
            apiGet("/fixtures?team=" + playersOut[0].teamId + "&last=4", 300),
          ]);
          [].concat(up || [], re || []).forEach(pushFx);
        }

        const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
        matchesOut.sort(function (a, b) { return rank(a.status) - rank(b.status); });

        return Response.json(
          { teams: teamsOut, matches: matchesOut, players: playersOut, venues: venuesOut },
          // Entity ranking only changes when the index is re-seeded, and the
          // fixtures attached to it are already cached per team. Letting the edge
          // hold the whole response means a popular prefix is served from the
          // colo, so the common keystrokes cost nothing at all.
          { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } }
        );
      }
    }

    // ── Legacy fallback ──────────────────────────────────────────────────────
    // Reached only while the index is empty (fresh deploy, seeder not run yet)
    // or if Supabase is unreachable. Delete once the index is seeded everywhere.
    const q = searchSafe(qRaw); // fold Turkish/accents; API needs ASCII
    if (q.length < 2) return Response.json({ teams: [], matches: [], players: [], venues: [] });

    // Players: API stores abbreviated first names ("E. Haaland", "A. Güler"), so the profile
    // search matches the surname best. For multi-word input search by the last token (surname),
    // then re-rank the candidates against ALL typed tokens so the right player isn't buried.
    const qTokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pq = qTokens.length > 1 ? qTokens[qTokens.length - 1] : q;
    // The API player search misses short/Turkish queries ("mes"->0, "yam"->0). Expand via the
    // popular-players list so famous names are found and re-ranked to the top.
    const popP = popRank(POP_PLAYERS, q);
    const playerTerms = [];
    if (pq.length >= 3) playerTerms.push(pq);
    popP.slice(0, 4).forEach(function (x) { if (playerTerms.indexOf(x.e.en) === -1) playerTerms.push(x.e.en); });
    const playerLists = await Promise.all(playerTerms.map(function (term) {
      return apiGet("/players/profiles?search=" + encodeURIComponent(term), 3600).then(function (d) { return d || []; }).catch(function () { return []; });
    }));
    const seenPl = {};
    const playerRaw = [];
    playerLists.forEach(function (lst) { (lst || []).forEach(function (it) { const pid = it.player && it.player.id; if (pid != null && !seenPl[pid]) { seenPl[pid] = 1; playerRaw.push(it); } }); });
    function pscore(p) {
      const hay = searchSafe(((p.name || "") + " " + (p.firstname || "") + " " + (p.lastname || ""))).toLowerCase();
      const words = hay.split(/\s+/).filter(Boolean);
      let sc = 0;
      qTokens.forEach(function (tok) {
        if (!tok) return;
        if (hay.indexOf(tok) >= 0) sc += 2;              // full token present ("arda")
        else if (words.indexOf(tok[0]) >= 0) sc += 1;    // initial match ("A." -> "a" vs "alper")
      });
      return sc;
    }
    const players = (playerRaw || [])
      .map(function (it) { return it.player || {}; })
      .map(function (p) { return { p: p, sc: pscore(p) * 10 + popOf(POP_PLAYERS, (p.name || "") + " " + (p.lastname || ""), true) }; })
      .sort(function (a, b) { if (b.sc !== a.sc) return b.sc - a.sc; return (a.p.id || 0) - (b.p.id || 0); })
      .filter(function (x) { return x.sc > 0; })
      .slice(0, 12)
      .map(function (x) {
        const p = x.p;
        return {
          id: p.id,
          // prefer the full "Arda Güler" over the abbreviated "A. Güler" the API returns in `name`
          name: (p.firstname && p.lastname && p.firstname.length > 2 && p.firstname.indexOf(".") === -1)
            ? (p.firstname + " " + p.lastname)
            : (p.name || ((p.firstname || "") + " " + (p.lastname || "")).trim()),
          photo: p.photo || null,
          age: p.age != null ? p.age : null,
          nationality: p.nationality || null,
          position: p.position || null,
        };
      });

    // ── Teams + matches ──
    // "fenerbahce" -> single team + its fixtures.  "fenerbahce besiktas" -> H2H between the two.
    const ql = q.toLowerCase();
    const isVariant = function (name) { return /\bU\s?\d{2}\b|women|\bW\b|\bII\b|\bB\b/i.test(name || ""); };
    const nameScore = function (name, target) {
      const nm = searchSafe(name || "").toLowerCase();
      if (!nm) return -1;
      let s = -1;
      if (nm === target) s = 3;
      else if (nm.indexOf(target) >= 0) s = 2;
      else if (target.indexOf(nm) >= 0) s = 1;
      if (s > 0 && isVariant(name)) s -= 2;
      return s;
    };
    const pickBest = function (list, target) {
      let best = null;
      (list || []).forEach(function (it) {
        const tt = it.team || {};
        const s = nameScore(tt.name, target);
        if (s > 0 && (best === null || s > best.s)) best = { t: tt, s: s };
      });
      return best ? best.t : null;
    };
    const searchTeam = async function (name) {
      const fn = searchSafe(name);
      if (fn.length < 3) return null;
      const d = await apiGet("/teams?search=" + encodeURIComponent(fn), 3600);
      return pickBest(d, fn.toLowerCase());
    };
    const mapTeam = function (tt) { return { id: tt.id, name: tt.name, logo: tt.logo, country: tt.country || null }; };

    // Expand the team query with popular clubs/countries so "arjantin"->Argentina, "ju"->Juventus,
    // and famous clubs get fetched even when the API's raw search ranks or misses them.
    const popT = popRank(POP_TEAMS, q);
    const teamTerms = [];
    if (q.length >= 3) teamTerms.push(q);
    popT.slice(0, 4).forEach(function (x) { if (teamTerms.indexOf(x.e.en) === -1) teamTerms.push(x.e.en); });
    const teamLists = await Promise.all(teamTerms.map(function (term) {
      return apiGet("/teams?search=" + encodeURIComponent(term), 3600).then(function (d) { return d || []; }).catch(function () { return []; });
    }));
    const seenTm = {};
    const teamFull = [];
    teamLists.forEach(function (lst) { (lst || []).forEach(function (it) { const tid = it.team && it.team.id; if (tid != null && !seenTm[tid]) { seenTm[tid] = 1; teamFull.push(it); } }); });

    // rank by string match, but let FAME dominate ties so "mil"->AC Milan (not Millwall), "rea"->Real Madrid
    const teamRanked = [];
    teamFull.forEach(function (it) {
      const tt = it.team || {};
      const nm = searchSafe(tt.name || "").toLowerCase();
      if (!nm) return;
      let base = 0;
      if (nm === ql || nm.indexOf(ql) === 0) base = 3;   // exact / starts-with
      else if (nm.indexOf(ql) >= 0) base = 2;             // contains
      else if (ql.indexOf(nm) >= 0) base = 1;             // query contains name
      const pop = popOf(POP_TEAMS, tt.name);              // 0..100 fame
      if (base <= 0 && pop <= 0) return;                  // irrelevant and unknown → drop
      if (isVariant(tt.name)) base -= 2;
      teamRanked.push({ t: tt, base: base, total: base * 40 + pop });
    });
    teamRanked.sort(function (a, b) { if (b.total !== a.total) return b.total - a.total; return (a.t.id || 0) - (b.t.id || 0); });
    const topTeams = teamRanked.slice(0, 8).map(function (x) { return x.t; });
    // single-team mode when the top result clearly IS the query: a strong string match, or a strong
    // single-word popular hit ("arjantin"/"real"/"ju") — so we pull that team's fixtures.
    const strongPopular = qTokens.length === 1 && popT.length && popT[0].m >= 3;
    let single = teamRanked.length && (teamRanked[0].base >= 2 || strongPopular) ? teamRanked[0].t : null;

    const teamsOut = [];
    const matchesOut = [];
    const seenFx = {};
    const pushFx = function (item) {
      if (!item || !item.fixture) return;
      const fid = String(item.fixture.id);
      if (seenFx[fid]) return;
      seenFx[fid] = true;
      matchesOut.push(mapFixture(item, item.league && item.league.name));
    };

    if (single) {
      topTeams.forEach(function (tt) { teamsOut.push(mapTeam(tt)); });
      const up = await apiGet("/fixtures?team=" + single.id + "&next=6", 120);
      const re = await apiGet("/fixtures?team=" + single.id + "&last=6", 300);
      [].concat(up || [], re || []).forEach(pushFx);
    } else {
      // two team names -> head-to-head
      const toks = q.split(/\s+/);
      let done = false;
      for (let i = 1; i < toks.length && !done; i++) {
        const ta = await searchTeam(toks.slice(0, i).join(" "));
        const tb = await searchTeam(toks.slice(i).join(" "));
        if (ta && tb && ta.id !== tb.id) {
          teamsOut.push(mapTeam(ta), mapTeam(tb));
          const nextH = await apiGet("/fixtures/headtohead?h2h=" + ta.id + "-" + tb.id + "&next=5", 120);
          const lastH = await apiGet("/fixtures/headtohead?h2h=" + ta.id + "-" + tb.id + "&last=10", 300);
          [].concat(nextH || [], lastH || []).forEach(pushFx);
          done = true;
        }
      }
      // fallback: best single team match + its fixtures
      if (!done) {
        const fb = await searchTeam(q);
        if (fb) {
          teamsOut.push(mapTeam(fb));
          const up = await apiGet("/fixtures?team=" + fb.id + "&next=6", 120);
          const re = await apiGet("/fixtures?team=" + fb.id + "&last=6", 300);
          [].concat(up || [], re || []).forEach(pushFx);
        }
      }
    }
    const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
    matchesOut.sort(function (a, b) { return rank(a.status) - rank(b.status); });

    return Response.json({ teams: teamsOut, matches: matchesOut, players: players, venues: [] });
  }

  // ── Player season stats + trophies (Sofascore-style profile page) ──
  if (mode === "player") {
    const id = searchParams.get("id");
    const season = searchParams.get("season") || 2025;
    if (!id) return Response.json({ player: null });

    // independent reads → parallel (same two calls, half the wait)
    const [statData, trophyData] = await Promise.all([
      apiGet("/players?id=" + id + "&season=" + season, 1800),
      apiGet("/trophies?player=" + id, 86400),
    ]);

    const trophies = (trophyData || []).map(function (tr) {
      return { league: tr.league || "", country: tr.country || "", season: tr.season || "", place: tr.place || "" };
    });
    let trophiesWon = 0;
    trophies.forEach(function (tr) { if ((tr.place || "").toLowerCase() === "winner") trophiesWon++; });

    let entry = (statData && statData[0]) ? statData[0] : null;
    let usedSeason = parseInt(season, 10);

    // A season is labelled by the year it STARTS in and rolls over in July, so for the first weeks
    // of a new one the API has no stats row yet for most players. That used to drop straight to the
    // profiles card below — which carries no team — and `teamId` came back null, which is the ONE
    // field the last-games endpoint needs. The result was a player who looked fine but had an empty
    // "Son 5 Maç" all summer. So look at the previous season once before giving up: it costs one
    // upstream call, only on the path that already found nothing, and it is cached like the rest.
    if (!entry) {
      const prevData = await apiGet("/players?id=" + id + "&season=" + (usedSeason - 1), 1800);
      if (prevData && prevData[0]) { entry = prevData[0]; usedSeason = usedSeason - 1; }
    }

    // still nothing (retired, or never in the API's stats): a basic profile card from /players/profiles
    if (!entry) {
      const prof = await apiGet("/players/profiles?player=" + id, 86400);
      const pp = (prof && prof[0] && prof[0].player) || null;
      if (!pp) return Response.json({ player: null });
      return Response.json({
        player: {
          id: pp.id,
          name: pp.name || ((pp.firstname || "") + " " + (pp.lastname || "")).trim(),
          photo: pp.photo || null,
          age: pp.age != null ? pp.age : null,
          nationality: pp.nationality || null,
          height: pp.height || null,
          weight: pp.weight || null,
          position: pp.position || null,
          team: { name: null, logo: null },
          teamId: null, // stated, not implied — the client branches on it
          season: parseInt(season, 10),
          totals: { appearances: 0, goals: 0, assists: 0, minutes: 0, yellow: 0, red: 0, rating: null },
          competitions: [],
          trophies: trophies,
          trophiesWon: trophiesWon,
        },
      });
    }

    const p = entry.player || {};
    const stats = entry.statistics || [];
    let apps = 0, lineups = 0, goals = 0, assists = 0, minutes = 0, yellow = 0, red = 0;
    let ratingSum = 0, ratingW = 0;
    // Raw per-action groups, summed across every competition. These feed the native app's radar
    // chart; they used to be dropped here, which left the radar with nothing real to plot.
    // Coverage is uneven — small cups return null for tackles/dribbles/pass accuracy where a big
    // league fills them in — so `num()` treats null as 0 for the sums, and `accW` weights pass
    // accuracy by the appearances that actually reported one instead of averaging the nulls in.
    const num = function (v) { const n = typeof v === "number" ? v : parseFloat(v); return isNaN(n) ? 0 : n; };
    const adv = {
      shotsTotal: 0, shotsOn: 0,
      passesTotal: 0, passesKey: 0, passAccuracy: null,
      tackles: 0, blocks: 0, interceptions: 0,
      duelsTotal: 0, duelsWon: 0,
      dribbleAttempts: 0, dribbleSuccess: 0,
      foulsDrawn: 0, foulsCommitted: 0,
      penScored: 0, penMissed: 0, penWon: 0,
    };
    let accSum = 0, accW = 0;
    const competitions = [];
    stats.forEach(function (s) {
      const g = s.games || {};
      const go = s.goals || {};
      const cd = s.cards || {};
      const sh = s.shots || {}, pa = s.passes || {}, tk = s.tackles || {};
      const du = s.duels || {}, dr = s.dribbles || {}, fo = s.fouls || {}, pe = s.penalty || {};
      const a = g.appearences || 0; // API spells it "appearences"
      apps += a;
      lineups += g.lineups || 0;
      goals += go.total || 0;
      assists += go.assists || 0;
      minutes += g.minutes || 0;
      yellow += cd.yellow || 0;
      red += (cd.red || 0) + (cd.yellowred || 0);
      if (g.rating != null) { const rv = parseFloat(g.rating); if (!isNaN(rv)) { ratingSum += rv * (a || 1); ratingW += (a || 1); } }
      adv.shotsTotal += num(sh.total); adv.shotsOn += num(sh.on);
      adv.passesTotal += num(pa.total); adv.passesKey += num(pa.key);
      if (pa.accuracy != null) { accSum += num(pa.accuracy) * (a || 1); accW += (a || 1); }
      adv.tackles += num(tk.total); adv.blocks += num(tk.blocks); adv.interceptions += num(tk.interceptions);
      adv.duelsTotal += num(du.total); adv.duelsWon += num(du.won);
      adv.dribbleAttempts += num(dr.attempts); adv.dribbleSuccess += num(dr.success);
      adv.foulsDrawn += num(fo.drawn); adv.foulsCommitted += num(fo.committed);
      adv.penScored += num(pe.scored); adv.penMissed += num(pe.missed); adv.penWon += num(pe.won);
      competitions.push({
        league: (s.league && s.league.name) || "",
        leagueId: (s.league && s.league.id) || null,
        leagueLogo: (s.league && s.league.logo) || null,
        leagueType: (s.league && s.league.type) || null,
        team: (s.team && s.team.name) || "",
        teamLogo: (s.team && s.team.logo) || null,
        appearances: a,
        lineups: g.lineups || 0,
        minutes: g.minutes || 0,
        goals: go.total || 0,
        assists: go.assists || 0,
        rating: g.rating != null ? Math.round(parseFloat(g.rating) * 100) / 100 : null,
      });
    });
    if (accW > 0) adv.passAccuracy = Math.round(accSum / accW);
    const primary = stats[0] || {};

    return Response.json({
      player: {
        id: p.id,
        name: p.name || ((p.firstname || "") + " " + (p.lastname || "")).trim(),
        photo: p.photo || null,
        age: p.age != null ? p.age : null,
        nationality: p.nationality || null,
        height: p.height || null,
        weight: p.weight || null,
        injured: !!p.injured,
        birth: p.birth || null,
        position: (primary.games && primary.games.position) || p.position || null,
        team: { name: (primary.team && primary.team.name) || null, logo: (primary.team && primary.team.logo) || null },
        teamId: (primary.team && primary.team.id) || null,
        // the season these numbers are actually FROM, which is not always the one that was asked
        // for (see the fallback above) — the client keys its last-games call off this
        season: usedSeason,
        totals: {
          appearances: apps, lineups: lineups, goals: goals, assists: assists, minutes: minutes,
          yellow: yellow, red: red,
          rating: ratingW > 0 ? Math.round(ratingSum / ratingW * 100) / 100 : null,
        },
        adv: adv,
        competitions: competitions,
        trophies: trophies,
        trophiesWon: trophiesWon,
      },
    });
  }

  // ── Fixture crests + score by fixture id (backfill logos/score onto older logs) ──
  if (mode === "fixturemeta") {
    const idsParam = searchParams.get("ids") || "";
    const ids = idsParam.split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
    if (!ids.length) return Response.json({ meta: {} });
    const data = await apiGet("/fixtures?ids=" + ids.join("-"), 86400);
    const meta = {};
    (data || []).forEach(function (f) {
      if (!f.fixture) return;
      const hg = f.goals ? f.goals.home : null, ag = f.goals ? f.goals.away : null;
      meta[String(f.fixture.id)] = {
        homeLogo: (f.teams && f.teams.home && f.teams.home.logo) || null,
        awayLogo: (f.teams && f.teams.away && f.teams.away.logo) || null,
        score: (hg != null && ag != null) ? (hg + " - " + ag) : null,
      };
    });
    return Response.json({ meta });
  }

  // ── A player's last games with the rating they earned (SofaScore-style form) ──
  if (mode === "playergames") {
    const id = searchParams.get("id");
    const team = searchParams.get("team");
    const season = searchParams.get("season") || 2025;
    if (!id || !team) return Response.json({ games: [] });
    const fxData = await apiGet("/fixtures?team=" + team + "&season=" + season + "&last=12", 3600);
    const done = { FT: 1, AET: 1, PEN: 1 };
    const fixtures = (fxData || []).filter(function (f) { return f.fixture && f.fixture.status && done[f.fixture.status.short]; });
    const out = [];
    // Per-fixture player sheets, fetched in PARALLEL batches of 6 instead of the old one-at-a-time
    // walk. Sequential, a regular starter cost 5 round-trips end to end (~2s cold) and a rotation
    // player up to 12. Batched, the first six go out together and the second six only if the first
    // didn't yield 5 featured games — so the worst case fetches the same 12 sheets it always did,
    // the typical case fetches 6 where it fetched 5–6, and the wall-clock drops to one or two
    // round-trips. The sheets are immutable (finished matches, 7d cache + Supabase), so the one
    // occasional extra fetch is a one-time cost per fixture, ever.
    function featureLine(pdata) {
      let rating = null, mins = null;
      (pdata || []).forEach(function (tp) {
        (tp.players || []).forEach(function (pl) {
          if (pl.player && String(pl.player.id) === String(id)) {
            const st = (pl.statistics && pl.statistics[0]) || {};
            const gm = st.games || {};
            if (gm.rating != null) { const rv = parseFloat(gm.rating); if (!isNaN(rv)) rating = rv; }
            mins = gm.minutes != null ? gm.minutes : null;
          }
        });
      });
      return { rating: rating, mins: mins };
    }
    for (let start = 0; start < fixtures.length && out.length < 5; start += 6) {
      const batch = fixtures.slice(start, start + 6);
      const sheets = await Promise.all(batch.map(function (f) {
        return apiGet("/fixtures/players?fixture=" + f.fixture.id, 604800); // finished -> immutable, 7d
      }));
      for (let i = 0; i < batch.length && out.length < 5; i++) {
      const f = batch[i];
      const fid = f.fixture.id;
      const line = featureLine(sheets[i]);
      const rating = line.rating, mins = line.mins;
      if (rating == null && (mins == null || mins === 0)) continue; // didn't feature
      const home = f.teams.home, away = f.teams.away;
      const isHome = String(home.id) === String(team);
      const opp = isHome ? away : home;
      const tg = isHome ? f.goals.home : f.goals.away;
      const og = isHome ? f.goals.away : f.goals.home;
      out.push({
        fixtureId: fid,
        date: f.fixture.date ? f.fixture.date.slice(0, 10) : null,
        opponent: opp.name, opponentLogo: opp.logo, home: isHome,
        score: (tg != null ? tg : "-") + "-" + (og != null ? og : "-"),
        result: (tg != null && og != null) ? (tg > og ? "W" : tg < og ? "L" : "D") : null,
        rating: rating != null ? Math.round(rating * 100) / 100 : null,
        minutes: mins,
        // the whole fixture in the same shape every other list uses, so tapping one of these rows can
        // open the normal match detail instead of a stub built from the opponent name alone
        match: mapFixture(f, f.league && f.league.name),
      });
      }
    }
    return Response.json({ games: out });
  }

  // ── Team profile: info + venue + domestic-season stats + rank + fixtures ──
  if (mode === "team") {
    const id = searchParams.get("id");
    const season = searchParams.get("season") || 2025;
    if (!id) return Response.json({ team: null });

    // Wave 1 — everything that only needs the team id, together. Profile, league list and the two
    // fixture windows used to run one after another (and the two league-dependent reads after THEM),
    // which put six round-trips end to end on this screen. Same six calls, two waves deep now.
    const [teamData, leaguesData, upcoming, recent] = await Promise.all([
      apiGet("/teams?id=" + id, 86400),
      apiGet("/leagues?team=" + id + "&season=" + season, 3600),
      apiGet("/fixtures?team=" + id + "&next=5", 120),
      apiGet("/fixtures?team=" + id + "&last=5", 300),
    ]);
    const entry = (teamData && teamData[0]) ? teamData[0] : null;
    if (!entry) return Response.json({ team: null });
    const tm = entry.team || {};
    const vn = entry.venue || {};

    // pick the domestic league (type "League") this season for stats + standings
    let domestic = null;
    (leaguesData || []).forEach(function (lx) {
      if (!domestic && lx.league && lx.league.type === "League") domestic = lx.league;
    });

    let stats = null;
    let league = null;
    if (domestic) {
      let rank = null, points = null;
      // Wave 2 — the two reads that had to wait for the domestic league id, together.
      const [sd, stData] = await Promise.all([
        apiGet("/teams/statistics?team=" + id + "&league=" + domestic.id + "&season=" + season, 1800),
        apiGet("/standings?league=" + domestic.id + "&season=" + season, 600),
      ]);
      if (sd) {
        const fx = sd.fixtures || {}; const g = sd.goals || {};
        stats = {
          form: sd.form ? sd.form.slice(-6).split("") : [],
          played: (fx.played && fx.played.total != null) ? fx.played.total : null,
          wins: (fx.wins && fx.wins.total) || 0,
          draws: (fx.draws && fx.draws.total) || 0,
          loses: (fx.loses && fx.loses.total) || 0,
          goalsFor: (g.for && g.for.total && g.for.total.total) || 0,
          goalsAgainst: (g.against && g.against.total && g.against.total.total) || 0,
          cleanSheets: (sd.clean_sheet && sd.clean_sheet.total) || 0,
        };
      }
      if (stData && stData[0] && stData[0].league && stData[0].league.standings) {
        stData[0].league.standings.forEach(function (group) {
          (group || []).forEach(function (row) {
            if (row.team && String(row.team.id) === String(id)) { rank = row.rank; points = row.points; }
          });
        });
      }
      league = { id: domestic.id, name: domestic.name, logo: domestic.logo, rank: rank, points: points };
    }

    const fixtures = []; // upcoming/recent were fetched in wave 1, with the team profile
    [].concat(upcoming || [], recent || []).forEach(function (item) {
      fixtures.push(mapFixture(item, item.league && item.league.name));
    });

    return Response.json({
      team: {
        id: tm.id, name: tm.name, logo: tm.logo, country: tm.country || null,
        founded: tm.founded || null, national: !!tm.national,
        venue: { name: vn.name || null, city: vn.city || null, capacity: vn.capacity || null },
        league: league,
        season: parseInt(season, 10),
        stats: stats,
        fixtures: fixtures,
      },
    });
  }

  // ── Venue backdrop + the next match played there (native app: Passport map popup) ──
  // The app sends the stadium `name` (+ a `team` hint). We resolve the API-Football venue → its photo
  // and id, then find the soonest UPCOMING fixture at that ground: PRIMARY the venue filter, FALLBACK
  // the ground's home team's next home game. Returns { venueId, image, fixture|null }. All calls go
  // through apiGet so they're Cloudflare-edge cached (venue lookup 30d, fixtures 15m).
  if (mode === "venue") {
    const name = (searchParams.get("name") || "").trim();
    const teamHint = (searchParams.get("team") || "").trim();
    const teamIdParam = (searchParams.get("teamId") || "").trim();
    if (name.length < 3 && teamHint.length < 3 && !teamIdParam) return Response.json({ venueId: null, image: null, fixture: null });

    const isVariant = function (nm) { return /\bU\s?\d{2}\b|women|\bW\b|\bII\b|\bB\b/i.test(nm || ""); };
    let venueId = null, image = null, teamId = null;

    // 0) BEST: an exact API-Football team id baked into the app's stadium data → /teams?id is exact
    //    (no fuzzy name search) and returns the team's venue id + image directly.
    if (teamIdParam) {
      const td = await apiGet("/teams?id=" + encodeURIComponent(teamIdParam), 86400);
      const e = td && td[0];
      if (e) {
        teamId = (e.team && e.team.id) || parseInt(teamIdParam, 10) || null;
        const vn = e.venue || {};
        venueId = vn.id || null;
        image = vn.image || null;
      }
    }

    // 1) else resolve via the ground's home team NAME — /teams?search returns team + venue (id + image).
    //    Fuzzier than an id, but fine when no baked id is available.
    if (!teamId && teamHint) {
      const td = await apiGet("/teams?search=" + encodeURIComponent(searchSafe(teamHint)), 86400);
      const tgt = searchSafe(teamHint).toLowerCase();
      let best = null;
      (td || []).forEach(function (e) {
        const tt = e.team || {}, nm = searchSafe(tt.name || "").toLowerCase();
        if (!nm) return;
        let s = nm === tgt ? 3 : (nm.indexOf(tgt) >= 0 || tgt.indexOf(nm) >= 0 ? 2 : 1);
        if (isVariant(tt.name)) s -= 2;
        if (!best || s > best.s) best = { e: e, s: s };
      });
      if (best) {
        teamId = best.e.team && best.e.team.id;
        const vn = best.e.venue || {};
        venueId = vn.id || null;
        image = vn.image || null;
      }
    }

    // 2) fallback: resolve the venue by stadium name (national/neutral grounds with no club team)
    if (!venueId && name.length >= 3) {
      const vlist = await apiGet("/venues?search=" + encodeURIComponent(searchSafe(name)), 2592000);
      const target = searchSafe(name).toLowerCase();
      let best = null;
      (vlist || []).forEach(function (v) {
        const nm = searchSafe(v.name || "").toLowerCase();
        if (!nm) return;
        let s = nm === target ? 3 : (nm.indexOf(target) >= 0 || target.indexOf(nm) >= 0 ? 2 : 1);
        if (!best || s > best.s) best = { v: v, s: s };
      });
      if (best) { venueId = best.v.id || null; image = best.v.image || null; }
    }

    // 3) next fixture: PRIMARY the venue filter, FALLBACK the home team's next home game
    let item = null;
    if (venueId) {
      const byVenue = await apiGet("/fixtures?venue=" + venueId + "&next=1", 900);
      if (byVenue && byVenue.length) item = byVenue[0];
    }
    if (!item && teamId) {
      const fx = await apiGet("/fixtures?team=" + teamId + "&next=10", 900);
      const homeGames = (fx || []).filter(function (f) { return f.teams && f.teams.home && String(f.teams.home.id) === String(teamId); });
      const atVenue = homeGames.filter(function (f) { return venueId && f.fixture && f.fixture.venue && String(f.fixture.venue.id) === String(venueId); });
      item = atVenue[0] || homeGames[0] || null;
    }

    return Response.json({
      venueId: venueId,
      image: image,
      fixture: item ? mapFixture(item, item.league && item.league.name) : null,
    }, {
      // The native app's Passport MAP popup fetches this from INSIDE a WebView (opaque origin) → needs CORS.
      // Short edge cache so repeat taps across users don't re-run the lookup. SWR 60, not 3600:
      // an answer cached during an upstream hiccup says "no upcoming match" at grounds that plainly
      // have one, and an hour of serve-stale kept that lie alive long after the edge could revalidate.
      // An EMPTY answer is also cached briefly (60s) rather than for the full 15 minutes.
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=" + (item ? 900 : 60) + ", stale-while-revalidate=60",
      },
    });
  }

  // ── Nearest attendable fixtures (native app: "Yakınındaki Maçlar") ──
  // The app sends candidate team ids in DISTANCE ORDER (nearest first) and we walk them, resolving each
  // ground's next home fixture, returning the first `limit` that HAVE one. Doing the fan-out HERE (not in
  // the app) means ONE request → one edge-cached response, and no client-side burst that trips the
  // api-sports rate limit — which is exactly what dropped nearby grounds and let farther ones show. The
  // app maps team id → its own stadium record for the name/city/distance shown on each card.
  if (mode === "nearby") {
    const ids = (searchParams.get("teams") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "3", 10) || 3, 5);
    const items = [];
    for (let i = 0; i < ids.length && items.length < limit; i++) {
      const r = await venueNextByTeamId(ids[i]);
      if (r.item) items.push({ teamId: ids[i], fixture: mapFixture(r.item, r.item.league && r.item.league.name) });
    }
    // Only a FULL result earns the long cache. A short one may be a cold-cache blip (an underlying fixture
    // call not warm yet), so cache it briefly — it re-heals within 30s instead of being stuck for 15m.
    // A LIVE item also gets a short cache — otherwise the 15m edge cache would freeze it at whatever
    // minute/score it had when first fetched, and (worse) would delay noticing it finished, so the passport
    // would keep pointing at a dead match instead of moving on to that venue's real next fixture.
    const full = items.length >= Math.min(limit, ids.length);
    const hasLive = items.some(function (it) { return it.fixture && it.fixture.status === "live"; });
    // A TODAY fixture is about to change state (kickoff → live → FT), and an answer cached in the
    // kickoff race window says "next league match" while the real one is being played at the ground —
    // so match day gets the live-grade TTL too, not just matches already in play.
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
    const hasToday = items.some(function (it) { return it.fixture && it.fixture.dateKey === todayKey; });
    const maxAge = !full || hasLive || hasToday ? 30 : 900;
    // SWR 60, not 3600: an hour of serve-stale on top of the cache was how a dead answer kept
    // winning long after the edge could have revalidated it.
    return Response.json({ items: items }, {
      headers: { "Cache-Control": "public, s-maxage=" + maxAge + ", stale-while-revalidate=60" },
    });
  }

  // ── Diagnostic: api-sports account plan + rate limits (temporary) ──
  if (mode === "quota") {
    try {
      const res = await fetch(HOST + "/status", { headers: hdr() });
      const j = await res.json();
      const rl = {};
      res.headers.forEach(function (v, k) { if (k.toLowerCase().indexOf("ratelimit") >= 0) rl[k] = v; });
      return Response.json({ status: j.response || null, rateLimitHeaders: rl, errors: j.errors || null });
    } catch (e) { return Response.json({ error: String(e) }); }
  }

  // ── Matches on a specific date (date strip on the right column) ──
  if (mode === "bydate") {
    const sport = searchParams.get("sport") || "football";
    const date = searchParams.get("date");
    if (!date) return Response.json({ matches: [] });

    if (sport === "football" || sport === "live") {
      const data = await apiGet("/fixtures?date=" + date, 120);
      // apiGet returns null when the upstream call failed (rate limit, 5xx, unparseable body) — and
      // `(data || [])` used to flatten that into the same empty list a genuinely quiet day produces.
      // For a PAST date the branch below then cached it for a day with a week of stale-while-
      // revalidate, so ONE rate-limited request blanked that date for everybody until the TTL ran
      // out. Measured 2026-07-30: 07-27, 07-28 and 07-30 were all serving a cached `{"matches":[]}`
      // while the origin had 100+ finished fixtures for each — the app's "Biten Maçlar" tab could
      // only ever show one of the three days it asks for. A failure is now a failure: 502, no-store.
      if (!data) return jsonNoStore({ matches: [], error: "upstream" }, 502);
      const nameById = LEAGUE_NAMES;
      // EVERY league on that date, not just the curated ones. The app exists to check people in at
      // grounds, including amateur and lower-division ones, so a fixture the whitelist had never
      // heard of is precisely the one it must not drop. The curated name still wins where we have
      // one — those are the short forms the UI is laid out for.
      const out = (data || []).map(function (item) {
        const lid = item.league && item.league.id;
        return mapFixture(item, nameById[lid] || null);
      });
      const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
      out.sort(function (a, b) { return rank(a.status) - rank(b.status); });
      // a past date can never change again; today and tomorrow still have games running.
      // An EMPTY past date is the exception — a day with no football at all is close to impossible,
      // so it reads as a coverage gap rather than a settled fact and gets the short TTL, not a day's.
      const settled = date < ymd(new Date()) && out.length > 0;
      return settled ? jsonCached({ matches: out }, 86400, 604800) : jsonCached({ matches: out }, 60, 300);
    }

    const HOSTS = { basketball: "https://v1.basketball.api-sports.io", volleyball: "https://v1.volleyball.api-sports.io" };
    const host = HOSTS[sport];
    if (!host) return Response.json({ matches: [] });
    try {
      const res = await fetch(host + "/games?date=" + date, { headers: hdr(), next: { revalidate: 120 } });
      const j = await res.json();
      const resp = (j && j.response) ? j.response : [];
      const out = [];
      resp.slice(0, 60).forEach(function (g, i) {
        const teams = g.teams || {}; const h = teams.home || {}; const a = teams.away || {};
        var st = "upcoming";
        var ss = (g.status && (g.status.short || g.status.long)) || "";
        if (/(finished|FT|AOT|Final)/i.test(ss)) st = "finished";
        else if (/(Q1|Q2|Q3|Q4|live|in play|HT|OT|set)/i.test(ss)) st = "live";
        var sc = null;
        if (g.scores && g.scores.home != null && g.scores.away != null) sc = g.scores.home + " - " + g.scores.away;
        var d = g.date ? new Date(typeof g.date === "string" ? g.date : (g.date.start || g.date)) : null;
        out.push({
          id: sport + "-" + (g.id || i), home: h.name || "?", away: a.name || "?", homeLogo: h.logo || null, awayLogo: a.logo || null,
          time: d ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "",
          date: d ? d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul" }) : "",
          league: (g.league && g.league.name) || "", status: st, score: sc, minute: null, namesOnly: true,
        });
      });
      return Response.json({ matches: out });
    } catch (e) { return Response.json({ matches: [] }); }
  }

  // ── Standout players of the (most recent) match day: top 3 by real match rating ──
  if (mode === "standouts") {
    const sport = searchParams.get("sport") || "football";
    if (sport !== "football" && sport !== "live") return Response.json({ players: [], date: null });
    const start = searchParams.get("date") || ymd(new Date());
    const nameById = LEAGUE_NAMES;
    // walk back up to a week to find the latest day with finished fixtures in our leagues
    let chosen = null, fixtures = [];
    for (let back = 0; back < 2 && !chosen; back++) {
      const dd = new Date(start + "T00:00:00");
      dd.setDate(dd.getDate() - back);
      const dk = ymd(dd);
      const data = await apiGet("/fixtures?date=" + dk, 3600);
      const fin = (data || []).filter(function (it) {
        return nameById[it.league && it.league.id] && statusOf(it.fixture.status && it.fixture.status.short) === "finished";
      });
      if (fin.length) { chosen = dk; fixtures = fin.slice(0, 3); }
    }
    if (!chosen) return Response.json({ players: [], date: null });
    const all = [];
    // three fixtures' sheets, independent → together (same calls, one round-trip of wait)
    const sheets = await Promise.all(fixtures.map(function (fx) {
      return apiGet("/fixtures/players?fixture=" + fx.fixture.id, 600);
    }));
    sheets.forEach(function (pdata) {
      (pdata || []).forEach(function (entry) {
        const tname = entry.team && entry.team.name;
        (entry.players || []).forEach(function (pp) {
          const p = pp.player || {};
          const st = (pp.statistics && pp.statistics[0]) || {};
          const g = st.games || {};
          if (g.rating == null) return;
          const rv = parseFloat(g.rating);
          if (isNaN(rv)) return;
          all.push({
            id: p.id, name: p.name || "?",
            photo: p.photo || (p.id ? "https://media.api-sports.io/football/players/" + p.id + ".png" : null),
            team: tname || "", rating: Math.round(rv * 100) / 100,
          });
        });
      });
    });
    all.sort(function (a, b) { return b.rating - a.rating; });
    return Response.json({ players: all.slice(0, 3), date: chosen });
  }

  // ── Team of the round (best XI) for a league's current knockout round. ──
  // Scoped for now to the World Cup Round of 32; move to "Round of 16" by changing the round param.
  // Finished-match player ratings are immutable, so each fixture is cached long -> recompute is ~free.
  if (mode === "totw") {
    const league = searchParams.get("league") || "1";
    const season = searchParams.get("season") || "2026";
    const round = (searchParams.get("round") || "Round of 32").trim();
    const rl = round.toLowerCase();
    const fxAll = await apiGet("/fixtures?league=" + league + "&season=" + season, 3600);
    const finished = (fxAll || []).filter(function (it) {
      const r = (it.league && it.league.round) || "";
      return r.toLowerCase().indexOf(rl) >= 0 && statusOf(it.fixture.status && it.fixture.status.short) === "finished";
    });
    if (!finished.length) return Response.json({ round: round, players: [], formation: null });
    const byId = {};
    for (const fx of finished) {
      const pdata = await apiGet("/fixtures/players?fixture=" + fx.fixture.id, 604800); // immutable -> 7d
      (pdata || []).forEach(function (entry) {
        const tname = entry.team && entry.team.name;
        const tlogo = entry.team && entry.team.logo;
        (entry.players || []).forEach(function (pp) {
          const p = pp.player || {};
          const st = (pp.statistics && pp.statistics[0]) || {};
          const g = st.games || {};
          if (g.rating == null) return;
          const rv = parseFloat(g.rating);
          if (isNaN(rv)) return;
          const prev = byId[p.id];
          if (!prev || rv > prev.rating) {
            byId[p.id] = {
              id: p.id, name: p.name || "?",
              photo: p.photo || (p.id ? "https://media.api-sports.io/football/players/" + p.id + ".png" : null),
              team: tname || "", teamLogo: tlogo || null, rating: Math.round(rv * 100) / 100,
              pos: (g.position || "M").charAt(0).toUpperCase(),
            };
          }
        });
      });
    }
    const pool = Object.keys(byId).map(function (k) { return byId[k]; });
    pool.sort(function (a, b) { return b.rating - a.rating; });
    // 4-3-3: 1 GK, 4 DEF, 3 MID, 3 FWD by position; fill any shortfall from the best remaining.
    const bucket = { G: [], D: [], M: [], F: [] };
    pool.forEach(function (p) { (bucket[p.pos] || bucket.M).push(p); });
    const need = { G: 1, D: 4, M: 3, F: 3 }, used = {}, xi = [];
    ["G", "D", "M", "F"].forEach(function (k) {
      (bucket[k] || []).slice(0, need[k]).forEach(function (p) { xi.push(Object.assign({ slot: k }, p)); used[p.id] = 1; });
    });
    if (xi.length < 11) pool.forEach(function (p) { if (xi.length < 11 && !used[p.id]) { xi.push(Object.assign({ slot: p.pos }, p)); used[p.id] = 1; } });
    return Response.json({ round: round, league: league, formation: "4-3-3", players: xi });
  }

  // ── Match actuals for scoring/comparison: 90' result, actual MOTM, actual player ratings ──
  if (mode === "matchactual") {
    const fixture = searchParams.get("fixture");
    if (!fixture) return Response.json({ ready: false });
    const fx = await apiGet("/fixtures?id=" + fixture, 600);
    const item = fx && fx[0];
    if (!item) return Response.json({ ready: false });
    const ft = (item.score && item.score.fulltime) || item.goals || {};
    let onextwo = null;
    if (ft.home != null && ft.away != null) onextwo = ft.home > ft.away ? "1" : (ft.home < ft.away ? "2" : "X");
    const pdata = await apiGet("/fixtures/players?fixture=" + fixture, 3600);
    const ratings = {}; let motmId = null, motmName = null, motmR = -1;
    (pdata || []).forEach(function (entry) {
      (entry.players || []).forEach(function (pp) {
        const p = pp.player || {};
        const g = ((pp.statistics && pp.statistics[0]) || {}).games || {};
        if (g.rating == null) return;
        const rv = parseFloat(g.rating);
        if (isNaN(rv)) return;
        ratings[String(p.id)] = Math.round(rv * 10) / 10;
        if (rv > motmR) { motmR = rv; motmId = p.id; motmName = p.name; }
      });
    });
    return Response.json({ ready: Object.keys(ratings).length > 0, onextwo: onextwo,
      motm: motmId ? { id: motmId, name: motmName } : null, ratings: ratings });
  }

  // ── Prediction candidates: probable XIs (with pitch grid) for a match's coupon ──
  if (mode === "predcandidates") {
    const fixture = searchParams.get("fixture");
    const home = searchParams.get("home");
    const away = searchParams.get("away");
    const sides = { home: { formation: null, teamId: home, starting: [] }, away: { formation: null, teamId: away, starting: [] } };
    function takeLineup(entry) {
      const tid = entry.team && entry.team.id;
      const side = String(tid) === String(home) ? "home" : (String(tid) === String(away) ? "away" : null);
      if (!side || sides[side].starting.length) return; // keep the first XI we find per side
      const tname = entry.team && entry.team.name;
      const arr = (entry.startXI || []).map(function (x) {
        const p = x.player || {};
        return { id: p.id, name: p.name || "?", position: p.pos || null, shirt: (p.number != null ? p.number : null),
          grid: p.grid || null, teamId: tid, team: tname || "",
          photo: p.id ? "https://media.api-sports.io/football/players/" + p.id + ".png" : null };
      });
      if (arr.length) { sides[side].formation = entry.formation || null; sides[side].starting = arr; }
    }
    // 1) announced starting XI
    if (fixture) { const lu = await apiGet("/fixtures/lineups?fixture=" + fixture, 600); (lu || []).forEach(takeLineup); }
    // 2) probable XI: each team's most recent starting XI (works a day+ ahead)
    for (const side of ["home", "away"]) {
      if (sides[side].starting.length) continue;
      const tId = side === "home" ? home : away;
      if (!tId) continue;
      const last = await apiGet("/fixtures?team=" + tId + "&last=1", 86400);
      const fxId = last && last[0] && last[0].fixture && last[0].fixture.id;
      if (!fxId) continue;
      const lu2 = await apiGet("/fixtures/lineups?fixture=" + fxId, 86400);
      (lu2 || []).forEach(function (entry) { if (entry.team && String(entry.team.id) === String(tId)) takeLineup(entry); });
    }
    let players = [].concat(sides.home.starting, sides.away.starting);
    const haveLineups = !!(sides.home.starting.length || sides.away.starting.length);
    // 3) last resort for the flat pool (no XI anywhere): full squads -> search list, no pitch
    if (players.length < 6) {
      for (const tId of [home, away]) {
        if (!tId) continue;
        const sq = await apiGet("/players/squads?team=" + tId, 604800);
        const grp = (sq && sq[0]) || null;
        const tname = grp && grp.team && grp.team.name;
        const tid = grp && grp.team && grp.team.id;
        ((grp && grp.players) || []).forEach(function (p) {
          players.push({ id: p.id, name: p.name || "?", position: p.position || null, teamId: tid, team: tname || "",
            photo: p.id ? "https://media.api-sports.io/football/players/" + p.id + ".png" : null });
        });
      }
    }
    const seen = {}, uniq = [];
    players.forEach(function (p) { if (p.id != null && !seen[p.id]) { seen[p.id] = 1; uniq.push(p); } });
    // system's 1 star suggestion: attacker first
    function rank(p) { const s = (p.position || "").toLowerCase(); if (s === "f" || s.indexOf("att") >= 0) return 0; if (s === "m" || s.indexOf("mid") >= 0) return 1; if (s === "d" || s.indexOf("def") >= 0) return 2; return 3; }
    // system's star suggestion: an attacking player (attacker/mid), varied per match (not always the
    // first one) via a stable hash of the fixture — so it changes match-to-match but stays consistent.
    function hashStr(s) { s = String(s || ""); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
    const noted = uniq.filter(function (p) { return rank(p) <= 1; }); // attackers + midfielders
    const pool = noted.length ? noted : uniq;
    const rating = pool.length ? [pool[hashStr(fixture || (home + "-" + away)) % pool.length]] : [];
    return Response.json({ players: uniq, rating: rating, lineups: haveLineups ? sides : null });
  }

  // ── League tree per sport (flashscore-style country -> leagues) ──
  if (mode === "leagues") {
    const sport = searchParams.get("sport") || "football";
    const TOP = ["World", "England", "Spain", "Germany", "Italy", "France", "Turkey", "Netherlands", "Portugal", "Belgium", "Brazil", "Argentina", "USA"];
    function sortGroups(byCountry) {
      return Object.keys(byCountry).sort(function (a, b) {
        const ia = TOP.indexOf(a), ib = TOP.indexOf(b);
        if (ia !== -1 || ib !== -1) { if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib; }
        return a.localeCompare(b);
      }).map(function (k) { return byCountry[k]; });
    }

    if (sport === "football" || sport === "live") {
      const LOGO = function (id) { return "https://media.api-sports.io/football/leagues/" + id + ".png"; };
      const groups = [];
      // International group (curated, no api call): World Cup 2026, UCL, UEL, Conference
      groups.push({ country: "International", flag: null, leagues: [
        { id: 1, name: "World Cup 2026", logo: LOGO(1), type: "Cup", season: 2026 },
        { id: 2, name: "UEFA Champions League", logo: LOGO(2), type: "Cup", season: 2025 },
        { id: 3, name: "UEFA Europa League", logo: LOGO(3), type: "Cup", season: 2025 },
        { id: 848, name: "UEFA Europa Conference League", logo: LOGO(848), type: "Cup", season: 2025 },
      ] });
      // only the top countries (down to USA) — small per-country calls, avoids the giant all-leagues parse
      const COUNTRIES = ["England", "Spain", "Germany", "Italy", "France", "Turkey", "Netherlands", "Portugal", "Belgium", "Brazil", "Argentina", "USA"];
      for (const country of COUNTRIES) {
        const data = await apiGet("/leagues?country=" + encodeURIComponent(country) + "&current=true", 86400);
        if (!data || !data.length) continue;
        let flag = null;
        const leagues = [];
        data.forEach(function (x) {
          const L = x.league || {}; const co = x.country || {};
          if (!flag && co.flag) flag = co.flag;
          let yr = null;
          (x.seasons || []).forEach(function (s) { if (s.current) yr = s.year; });
          if (yr == null || yr < 2024) return;
          leagues.push({ id: L.id, name: L.name, logo: L.logo, type: L.type, season: yr });
        });
        leagues.sort(function (a, b) {
          var ka = leagueTierKey(a), kb = leagueTierKey(b);
          if (ka !== kb) return ka - kb;
          if (a.id !== b.id) return a.id - b.id;
          return a.name.localeCompare(b.name);
        });
        if (leagues.length) groups.push({ country: country, flag: flag, leagues: leagues.slice(0, 4) });
      }
      return Response.json({ leagues: groups });
    }

    const HOSTS = { basketball: "https://v1.basketball.api-sports.io", volleyball: "https://v1.volleyball.api-sports.io" };
    const host = HOSTS[sport];
    if (!host) return Response.json({ leagues: [] });
    try {
      const res = await fetch(host + "/leagues", { headers: hdr(), next: { revalidate: 86400 } });
      const j = await res.json();
      const resp = (j && j.response) ? j.response : [];
      const byCountry = {};
      resp.forEach(function (x) {
        const co = x.country || {};
        const cname = (typeof co === "string") ? co : (co.name || "—");
        const flag = (typeof co === "object") ? (co.flag || null) : null;
        const seasons = x.seasons || [];
        let yr = null;
        if (seasons.length) { const last = seasons[seasons.length - 1]; yr = last.season || last.year || null; }
        if (!byCountry[cname]) byCountry[cname] = { country: cname, flag: flag, leagues: [] };
        byCountry[cname].leagues.push({ id: x.id, name: x.name, logo: x.logo || null, type: x.type || "League", season: yr });
      });
      return Response.json({ leagues: sortGroups(byCountry) });
    } catch (e) { return Response.json({ leagues: [] }); }
  }

  // ── Fixtures for one league (clicked in the league tree) ──
  if (mode === "leaguefixtures") {
    const sport = searchParams.get("sport") || "football";
    const league = searchParams.get("league");
    const season = searchParams.get("season") || 2025;
    if (!league) return Response.json({ matches: [] });

    if (sport === "football" || sport === "live") {
      const today = new Date();
      const from = new Date(today); from.setDate(today.getDate() - 8);
      const to = new Date(today); to.setDate(today.getDate() + 30);
      const dFrom = from.toISOString().split("T")[0];
      const dTo = to.toISOString().split("T")[0];
      let data = await apiGet("/fixtures?league=" + league + "&season=" + season + "&from=" + dFrom + "&to=" + dTo, 60);
      if (!data || !data.length) data = await apiGet("/fixtures?league=" + league + "&season=" + season + "&last=20", 120);
      // current season not started yet -> show last season's recent matches
      if (!data || !data.length) data = await apiGet("/fixtures?league=" + league + "&season=" + (parseInt(season, 10) - 1) + "&last=20", 600);
      const out = (data || []).map(function (item) { return mapFixture(item, item.league && item.league.name); });
      const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
      // live + upcoming (soonest first) before finished (newest first), THEN cap — so upcoming is never cut off
      out.sort(function (a, b) {
        const ra = rank(a.status), rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        return ra === 2 ? ((b.ts || 0) - (a.ts || 0)) : ((a.ts || 0) - (b.ts || 0));
      });
      return Response.json({ matches: out.slice(0, 80) });
    }

    const HOSTS = { basketball: "https://v1.basketball.api-sports.io", volleyball: "https://v1.volleyball.api-sports.io" };
    const host = HOSTS[sport];
    if (!host) return Response.json({ matches: [] });
    try {
      const res = await fetch(host + "/games?league=" + league + "&season=" + season, { headers: hdr(), next: { revalidate: 120 } });
      const j = await res.json();
      const resp = (j && j.response) ? j.response : [];
      const out = [];
      resp.slice(0, 40).forEach(function (g, i) {
        const teams = g.teams || {}; const h = teams.home || {}; const a = teams.away || {};
        const dt = g.date || (g.fixture && g.fixture.date) || null;
        const d = dt ? new Date(typeof dt === "string" ? dt : (dt.start || dt)) : null;
        var st = "upcoming";
        var ss = (g.status && (g.status.short || g.status.long)) || "";
        if (/(finished|FT|AOT|Final)/i.test(ss)) st = "finished";
        else if (/(Q1|Q2|Q3|Q4|live|in play|HT|OT|set)/i.test(ss)) st = "live";
        var sc = null;
        if (g.scores && g.scores.home != null && g.scores.away != null) sc = g.scores.home + " - " + g.scores.away;
        out.push({
          id: sport + "-" + (g.id || i),
          home: h.name || "?", away: a.name || "?", homeLogo: h.logo || null, awayLogo: a.logo || null,
          time: d ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "",
          date: d ? d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul" }) : "",
          league: (g.league && g.league.name) || "", status: st, score: sc, minute: null, namesOnly: true,
        });
      });
      return Response.json({ matches: out });
    } catch (e) { return Response.json({ matches: [] }); }
  }

  // ── Weather by city (Open-Meteo, free, no key) ──
  if (mode === "weather") {
    const city = searchParams.get("city");
    if (!city || city === "—") return Response.json({ weather: null });
    try {
      const geo = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(city) + "&count=1", { next: { revalidate: 86400 } });
      const gj = await geo.json();
      if (!gj.results || !gj.results[0]) return Response.json({ weather: null });
      const lat = gj.results[0].latitude, lon = gj.results[0].longitude;
      const wx = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat +
        "&longitude=" + lon + "&current=temperature_2m,weather_code", { next: { revalidate: 1800 } });
      const wj = await wx.json();
      if (!wj.current) return Response.json({ weather: null });
      return Response.json({ weather: {
        temp: Math.round(wj.current.temperature_2m),
        code: wj.current.weather_code,
      }});
    } catch (e) {
      return Response.json({ weather: null });
    }
  }

  // ── Standings: full group tables (robust; position = array order) ──
  if (mode === "standings") {
    const leagueId = searchParams.get("league");
    const season = searchParams.get("season") || 2025;
    // a completed (past) season is immutable -> 30 days (persisted); the in-progress one -> 30 min edge.
    const nowM = new Date();
    const CURRENT_SEASON = nowM.getMonth() >= 6 ? nowM.getFullYear() : nowM.getFullYear() - 1;
    const stTtl = (parseInt(season, 10) < CURRENT_SEASON) ? 2592000 : 1800;
    let data = await apiGet("/standings?league=" + leagueId + "&season=" + season, stTtl);
    // current season has no table yet -> fall back to previous season (immutable -> 30 days, persisted)
    if (!data || !data[0] || !data[0].league || !data[0].league.standings) {
      data = await apiGet("/standings?league=" + leagueId + "&season=" + (parseInt(season, 10) - 1), 2592000);
    }
    const groups = [];
    if (data && data[0] && data[0].league && data[0].league.standings) {
      data[0].league.standings.forEach(function (group) {
        const rows = (group || []).map(function (row) {
          const all = row.all || {};
          return {
            teamId: row.team.id,
            team: row.team.name,
            logo: row.team.logo,
            played: all.played != null ? all.played : null,
            win: all.win, draw: all.draw, lose: all.lose,
            gd: row.goalsDiff,
            points: row.points,
          };
        });
        var gname = (group[0] && group[0].group) || null;
        groups.push({ name: gname, rows: rows });
      });
    }
    return Response.json({ standings: { groups: groups } });
  }

  // ── Top scorers ──
  if (mode === "scorers") {
    const leagueId = searchParams.get("league");
    const season = searchParams.get("season") || 2025;
    let data = await apiGet("/players/topscorers?league=" + leagueId + "&season=" + season, 600);
    if (!data || !data.length) data = await apiGet("/players/topscorers?league=" + leagueId + "&season=" + (parseInt(season, 10) - 1), 600);
    const list = [];
    (data || []).slice(0, 10).forEach(function (p) {
      const st = (p.statistics && p.statistics[0]) || {};
      list.push({
        id: p.player && p.player.id,
        name: p.player.name,
        photo: p.player.photo || null,
        team: (st.team && st.team.name) || "",
        teamLogo: (st.team && st.team.logo) || null,
        goals: (st.goals && st.goals.total) || 0,
      });
    });
    return Response.json({ scorers: list });
  }

  // ── Top assists ──
  if (mode === "assists") {
    const leagueId = searchParams.get("league");
    const season = searchParams.get("season") || 2025;
    const data = await apiGet("/players/topassists?league=" + leagueId + "&season=" + season, 600);
    const list = [];
    (data || []).slice(0, 10).forEach(function (p) {
      const st = (p.statistics && p.statistics[0]) || {};
      list.push({
        name: p.player.name,
        photo: p.player.photo || null,
        team: (st.team && st.team.name) || "",
        teamLogo: (st.team && st.team.logo) || null,
        assists: (st.goals && st.goals.assists) || 0,
      });
    });
    return Response.json({ assists: list });
  }

  // ── Head to head ──
  if (mode === "h2h") {
    const home = searchParams.get("home");
    const away = searchParams.get("away");
    const data = await apiGet("/fixtures/headtohead?h2h=" + home + "-" + away + "&last=20", 300);
    let homeWins = 0, awayWins = 0, draws = 0;
    const list = [];
    (data || []).forEach(function (item) {
      const g = item.goals || {};
      if (g.home == null || g.away == null) return;
      if (g.home === g.away) draws++;
      else if ((item.teams.home.id == home && g.home > g.away) || (item.teams.away.id == home && g.away > g.home)) homeWins++;
      else awayWins++;
      const d = new Date(item.fixture.date);
      list.push({
        date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Istanbul" }),
        ts: item.fixture.date,
        home: item.teams.home.name,
        away: item.teams.away.name,
        score: g.home + " - " + g.away,
        league: (item.league && item.league.name) || "",
        // enough to open the past match's OWN detail from the app
        id: item.fixture.id,
        homeId: item.teams.home.id,
        awayId: item.teams.away.id,
        homeLogo: item.teams.home.logo,
        awayLogo: item.teams.away.logo,
        leagueId: item.league && item.league.id,
        season: item.league && item.league.season,
        status: "finished",
      });
    });
    list.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
    return Response.json({ h2h: { total: homeWins + awayWins + draws, homeWins, awayWins, draws }, list: list.slice(0, 8) });
  }

  // ── Recent: last 5 finished with scores ──
  if (mode === "recent") {
    const homeId = searchParams.get("home");
    const awayId = searchParams.get("away");
    async function lastFive(teamId) {
      if (!teamId) return [];
      const data = await apiGet("/fixtures?team=" + teamId + "&last=5", 300);
      const out = [];
      (data || []).forEach(function (item) {
        const g = item.goals || {};
        if (g.home == null || g.away == null) return;
        const isHome = item.teams.home.id == teamId;
        const my = isHome ? g.home : g.away;
        const opp = isHome ? g.away : g.home;
        let result = "D";
        if (my > opp) result = "W"; else if (my < opp) result = "L";
        const oppName = isHome ? item.teams.away.name : item.teams.home.name;
        out.push({ result: result, score: my + "-" + opp, opp: oppName, home: isHome });
      });
      return out;
    }
    const home = await lastFive(homeId);
    const away = await lastFive(awayId);
    return Response.json({ recent: { home: home, away: away } });
  }

  // ── Detail: lineups + statistics + events timeline + injuries + season stats ──
  if (mode === "detail") {
    const fixtureId = searchParams.get("match");
    const leagueId = searchParams.get("league");
    const season = searchParams.get("season") || 2025;
    const homeTeam = searchParams.get("home");
    const awayTeam = searchParams.get("away");
    const status = searchParams.get("status") || "";

    // TTL by match state: a FINISHED match is immutable -> 30 days (persisted to Supabase,
    // so later opens = 0 API). LIVE -> 30s (slight delay is fine). UPCOMING -> 5 min.
    const finished = status === "finished";
    const T = finished ? 2592000 : (status === "live" ? 30 : 300);
    // The five upstream reads are independent of each other, so they go out TOGETHER. Awaited one
    // by one (how this used to read) the response time was the SUM of five api-sports round-trips —
    // 1.5–3s on cold cache — for the exact same number of calls. Parallel, it is the slowest single
    // one. Same quota, one-fifth the wait; this endpoint is the app's most-opened screen.
    // fxData = fixture head (live minute + running score + status) — cached at the same T, so a
    // LIVE match's detail keeps ticking (30s) instead of relying on the 5-min list feed.
    const [lineupData, statsData, eventsData, playersData, fxData] = await Promise.all([
      apiGet("/fixtures/lineups?fixture=" + fixtureId, T),
      apiGet("/fixtures/statistics?fixture=" + fixtureId, T),
      apiGet("/fixtures/events?fixture=" + fixtureId, T),
      apiGet("/fixtures/players?fixture=" + fixtureId, T),
      apiGet("/fixtures?id=" + fixtureId, T),
    ]);
    const fx = fxData && fxData[0];
    const live = fx ? {
      minute: (fx.fixture && fx.fixture.status && fx.fixture.status.elapsed != null) ? fx.fixture.status.elapsed : null,
      extra: (fx.fixture && fx.fixture.status && fx.fixture.status.extra != null) ? fx.fixture.status.extra : null,
      statusShort: fx.fixture && fx.fixture.status ? fx.fixture.status.short : null,
      home: fx.goals ? fx.goals.home : null,
      away: fx.goals ? fx.goals.away : null,
    } : null;
    const hasMatchStats = !!(statsData && statsData.length);
    // injuries + season averages are only shown before kickoff -> skip them once the match has stats
    const injuryData = hasMatchStats ? null : await apiGet("/injuries?fixture=" + fixtureId, 300);

    function sideLineup(entry) {
      if (!entry) return { formation: null, starting: [], bench: [], coach: null, teamId: null, color: null };
      function mapP(arr) {
        return (arr || []).map(function (x) {
          const p = x.player || {};
          return {
            id: p.id, name: p.name || "?",
            position: p.pos || null,
            shirt: p.number != null ? p.number : null,
            grid: p.grid || null,
            // photo follows a stable id-based URL, so heads render even when /fixtures/players is empty
            photo: p.id ? "https://media.api-sports.io/football/players/" + p.id + ".png" : null,
          };
        });
      }
      var color = null;
      if (entry.team && entry.team.colors && entry.team.colors.player && entry.team.colors.player.primary) {
        color = "#" + entry.team.colors.player.primary;
      }
      return {
        formation: entry.formation || null,
        starting: mapP(entry.startXI),
        bench: mapP(entry.substitutes),
        coach: entry.coach && entry.coach.name ? { id: entry.coach.id != null ? String(entry.coach.id) : null, name: entry.coach.name, photo: entry.coach.photo || null } : null,
        teamId: entry.team && entry.team.id,
        color: color,
      };
    }

    function sideStats(entry) {
      if (!entry || !entry.statistics) return null;
      const obj = {};
      entry.statistics.forEach(function (s) { obj[s.type] = s.value; });
      return obj;
    }

    // Endpoints don't guarantee home-first ordering, so match each entry by team id
    // (fall back to array index only if id matching fails).
    function pickByTeam(arr, teamId, idx, otherEntry) {
      if (!arr) return null;
      if (teamId) {
        const m = arr.filter(function (e) { return e.team && String(e.team.id) === String(teamId); })[0];
        if (m) return m;
      }
      const cand = arr[idx];
      if (cand && cand !== otherEntry) return cand;
      return arr.filter(function (e) { return e !== otherEntry; })[0] || null;
    }
    const homeLUEntry = pickByTeam(lineupData, homeTeam, 0, null);
    const awayLUEntry = pickByTeam(lineupData, awayTeam, 1, homeLUEntry);
    const homeStatEntry = pickByTeam(statsData, homeTeam, 0, null);
    const awayStatEntry = pickByTeam(statsData, awayTeam, 1, homeStatEntry);
    const homeLU = sideLineup(homeLUEntry);
    const awayLU = sideLineup(awayLUEntry);
    const homeStats = homeStatEntry ? sideStats(homeStatEntry) : null;
    const awayStats = awayStatEntry ? sideStats(awayStatEntry) : null;
    const homeTeamId = (homeLU.teamId != null) ? homeLU.teamId : (homeTeam ? parseInt(homeTeam, 10) : null);
    const awayTeamId = (awayLU.teamId != null) ? awayLU.teamId : (awayTeam ? parseInt(awayTeam, 10) : null);

    // substitutions (for pitch red badge)
    const subs = [];
    (eventsData || []).forEach(function (ev) {
      if (ev.type && ev.type.toLowerCase() === "subst") {
        subs.push({
          teamId: ev.team && ev.team.id,
          outId: ev.player && ev.player.id,
          outName: (ev.player && ev.player.name) || "",
          inId: ev.assist && ev.assist.id,
          inName: (ev.assist && ev.assist.name) || "",
          minute: (ev.time && ev.time.elapsed) || null,
        });
      }
    });

    // timeline with running score
    var runHome = 0, runAway = 0;
    const timeline = [];
    (eventsData || []).slice().sort(function (a, b) {
      var ae = (a.time.elapsed || 0) + (a.time.extra || 0) / 100;
      var be = (b.time.elapsed || 0) + (b.time.extra || 0) / 100;
      return ae - be;
    }).forEach(function (ev) {
      // skip penalty-shootout kicks — they'd otherwise inflate the running score; shown via penScore instead
      if ((ev.comments || "").toLowerCase().indexOf("penalty shootout") >= 0) return;
      var type = (ev.type || "").toLowerCase();
      var detail = ev.detail || "";
      var isHome = homeTeamId != null && ev.team && ev.team.id === homeTeamId;
      var scoreAt = null;
      if (type === "goal" && detail !== "Missed Penalty") {
        // own goal counts for the opponent
        if (detail === "Own Goal") { if (isHome) runAway++; else runHome++; }
        else { if (isHome) runHome++; else runAway++; }
        scoreAt = runHome + "-" + runAway;
      }
      timeline.push({
        minute: (ev.time && ev.time.elapsed) != null ? ev.time.elapsed : null,
        extra: (ev.time && ev.time.extra) || null,
        side: isHome ? "home" : "away",
        type: type, detail: detail,
        player: (ev.player && ev.player.name) || "",
        playerId: (ev.player && ev.player.id) || null,
        assist: (ev.assist && ev.assist.name) || "",
        assistId: (ev.assist && ev.assist.id) || null,
        score: scoreAt,
      });
    });

    // injuries / suspensions
    const injuries = [];
    (injuryData || []).forEach(function (it) {
      injuries.push({
        teamId: it.team && it.team.id,
        player: (it.player && it.player.name) || "",
        type: (it.player && it.player.type) || "",     // "Missing Fixture" etc.
        reason: (it.player && it.player.reason) || "", // "Injury", "Suspended", etc.
      });
    });

    // season averages (derived pre-match stats)
    async function teamSeason(teamId) {
      if (!teamId || !leagueId) return null;
      const d = await apiGet("/teams/statistics?league=" + leagueId + "&season=" + season + "&team=" + teamId, 1800);
      if (!d) return null;
      var played = d.fixtures && d.fixtures.played && d.fixtures.played.total;
      return {
        played: played != null ? played : null,
        gfAvg: d.goals && d.goals.for && d.goals.for.average && d.goals.for.average.total,
        gaAvg: d.goals && d.goals.against && d.goals.against.average && d.goals.against.average.total,
        cleanSheet: d.clean_sheet && d.clean_sheet.total,
        failedToScore: d.failed_to_score && d.failed_to_score.total,
        form: d.form ? d.form.slice(-5).split("") : [],
        wins: d.fixtures && d.fixtures.wins && d.fixtures.wins.total,
        draws: d.fixtures && d.fixtures.draws && d.fixtures.draws.total,
        loses: d.fixtures && d.fixtures.loses && d.fixtures.loses.total,
      };
    }
    const homeSeason = hasMatchStats ? null : await teamSeason(homeTeam);
    const awaySeason = hasMatchStats ? null : await teamSeason(awayTeam);

    // per-player match stats (Sofascore-style). One side = one /fixtures/players entry.
    function mapPlayers(entry, side) {
      if (!entry || !entry.players) return [];
      return entry.players.map(function (pp) {
        const p = pp.player || {};
        const st = (pp.statistics && pp.statistics[0]) || {};
        const games = st.games || {};
        const shots = st.shots || {};
        const goals = st.goals || {};
        const passes = st.passes || {};
        const dribbles = st.dribbles || {};
        const fouls = st.fouls || {};
        const cards = st.cards || {};
        const tackles = st.tackles || {};
        const duels = st.duels || {};
        const penalty = st.penalty || {};
        // API gives passes.accuracy as a percentage value; derive accurate count from total.
        const passPct = passes.accuracy != null ? parseInt(passes.accuracy, 10) : null;
        const passTotal = passes.total != null ? passes.total : null;
        const passAccurate = (passTotal != null && passPct != null) ? Math.round(passTotal * passPct / 100) : null;
        return {
          id: p.id,
          name: p.name || "?",
          photo: p.photo || null,
          side: side,
          rating: games.rating != null ? parseFloat(games.rating) : null,
          minutes: games.minutes != null ? games.minutes : 0, // 0/null => did not play
          position: games.position || null, // G/D/M/F — lets the client show keeper-specific stats
          goals: goals.total || 0,
          assists: goals.assists || 0,
          saves: goals.saves || 0,        // goalkeeper saves
          conceded: goals.conceded || 0,  // goals conceded (keeper)
          shotsTotal: shots.total || 0,
          shotsOn: shots.on || 0,
          passesTotal: passTotal,
          passesAccurate: passAccurate,
          passesPct: passPct,
          dribbleAttempts: dribbles.attempts || 0,
          dribbleSuccess: dribbles.success || 0,
          dispossessed: dribbles.past != null ? dribbles.past : null, // API has no clean "ball lost"; closest signal
          foulsDrawn: fouls.drawn || 0,
          foulsCommitted: fouls.committed || 0,
          yellow: cards.yellow || 0,
          red: cards.red || 0,
          // Advanced per-player stats (Sofascore-style). API coverage varies by league, so these
          // are null when absent and the client hides the row rather than showing a fake 0.
          keyPasses: passes.key != null ? passes.key : null,
          tackles: tackles.total != null ? tackles.total : null,
          interceptions: tackles.interceptions != null ? tackles.interceptions : null,
          blocks: tackles.blocks != null ? tackles.blocks : null,
          duelsTotal: duels.total != null ? duels.total : null,
          duelsWon: duels.won != null ? duels.won : null,
          dribbledPast: dribbles.past != null ? dribbles.past : null, // times the player was dribbled past (defensive)
          offsides: st.offsides != null ? st.offsides : null,
          penScored: penalty.scored != null ? penalty.scored : null,
          penMissed: penalty.missed != null ? penalty.missed : null,
          penSaved: penalty.saved != null ? penalty.saved : null,
          penWon: penalty.won != null ? penalty.won : null,
          penCommitted: penalty.commited != null ? penalty.commited : null, // API-Football spells it "commited"
          captain: !!games.captain,
          substitute: !!games.substitute,
          number: games.number != null ? games.number : null,
        };
      });
    }
    function sidePlayers(teamId, fallbackIdx) {
      if (!playersData) return [];
      var entry = null;
      if (teamId != null) entry = playersData.filter(function (e) { return e.team && e.team.id === teamId; })[0];
      if (!entry) entry = playersData[fallbackIdx];
      return mapPlayers(entry, fallbackIdx === 0 ? "home" : "away");
    }
    const homePlayers = sidePlayers(homeTeamId, 0);
    const awayPlayers = sidePlayers(awayTeamId, 1);

    // Same TTL rule the upstream calls use (T above): a finished match is a historical record, a live
    // one is worth 30 seconds. This is the heaviest response in the file — lineups, per-player stats,
    // timeline — so serving it from the colo is where the biggest saving is.
    return jsonCached({
      detail: {
        lineups: { home: homeLU, away: awayLU },
        stats: { home: homeStats, away: awayStats },
        subs: subs,
        colors: { home: homeLU.color, away: awayLU.color },
        timeline: timeline,
        injuries: injuries,
        season: { home: homeSeason, away: awaySeason },
        playerStats: { home: homePlayers, away: awayPlayers },
        live: live,
      },
    }, T, T * 4);
  }

  // ── List: everything that is live, or kicking off / played within the window ──
  //
  // Fetched BY DATE, not league by league. Three things fall out of that, all of them the point:
  //   · no season parameter, so it cannot rot the way the pinned `season: 2025` did — a date is a
  //     date, and the API resolves whichever season it belongs to;
  //   · no whitelist, so amateur and lower divisions come through. Checking in at a ground is the
  //     product; a league we never thought to list is exactly the one that must not be missing;
  //   · a handful of parallel calls instead of one sequential call per tracked league.
  const LIST_DAYS_AHEAD = 2;  // today + 2 — matches the window the app bands by day
  const LIST_DAYS_BACK = 1;   // yesterday, so last night's results are still in the feed
  const dayKeys = [];
  for (let i = -LIST_DAYS_BACK; i <= LIST_DAYS_AHEAD; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dayKeys.push({ key: d.toISOString().split("T")[0], today: i === 0 });
  }

  const nameById = LEAGUE_NAMES;

  const all = [];
  const seen = {};
  function add(item) {
    var id = String(item.fixture.id);
    if (seen[id]) return;
    seen[id] = true;
    var lid = item.league && item.league.id;
    all.push(mapFixture(item, nameById[lid] || null));
  }

  // Live first and on its own short cache: a day's fixtures can sit on a 15-minute cache, but a
  // score and a minute cannot.
  const liveData = await apiGet("/fixtures?live=all", 20);
  (liveData || []).forEach(add);

  // Today still has games in flight (short TTL); the other days are settled or not yet played.
  const days = await Promise.all(dayKeys.map(function (d) {
    return apiGet("/fixtures?date=" + d.key, d.today ? 120 : 900).catch(function () { return []; });
  }));
  days.forEach(function (list) { (list || []).forEach(add); });

  // live → upcoming (soonest first) → finished (newest first). The native app re-sorts with league
  // precedence on top of this; the web reads the order as-is.
  function rank(s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); }
  all.sort(function (a, b) {
    var ra = rank(a.status), rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    return ra === 2 ? ((b.ts || 0) - (a.ts || 0)) : ((a.ts || 0) - (b.ts || 0));
  });

  // `exclude=finished`: this feed drives the app's live + upcoming tabs only — its "Biten Maçlar" tab
  // is fed by mode=bydate, which reaches further back than this window does anyway. Yesterday's
  // results were a third of the fixtures here and not one of them was ever rendered from this call;
  // worse, once the response is capped they were taking cap slots away from fixtures that ARE shown.
  const dropped = (searchParams.get("exclude") || "").split(",");
  const feed = dropped.indexOf("finished") >= 0
    ? all.filter(function (m) { return m.status !== "finished"; })
    : all;

  // Optional trim, for clients that want the curated leagues rather than the whole world (the app
  // asks for `tier=priority&limit=100`; the web sends neither and gets the full feed as before).
  //
  // Priority-FIRST, not priority-sorted. Sorting by league and then cutting would still be a cut by
  // KICK-OFF TIME, and on 2026-07-30 the first 400 fixtures by kick-off were 385 friendlies, U20 and
  // Regionalliga games with not a single curated one among them: late July is precisely when the big
  // leagues are not playing, so the nearest fixtures are all somebody else's. Taking the priority
  // leagues whole and topping the rest up to the cap is what puts a Champions League qualifier on the
  // screen in a week when the only thing kicking off tonight is a third-tier friendly.
  //
  // The -1..+2 window is NOT widened to go looking for them. When the curated leagues have nothing in
  // it, the cap is simply filled from everyone else — a short feed of what is actually being played
  // beats a long one padded with fixtures a fortnight out.
  // The cap counts FIXTURES. A match being played is spent past the point where curating it means
  // anything — the user may have it open, may have checked in to it, watched it leave the upcoming
  // tab an hour ago — so it is settled separately and does not eat a slot. Otherwise a busy Saturday
  // of kick-offs makes the list contradict itself: the match is gone from upcoming because it
  // started, and missing from live because the quota ran out.
  //
  // Exempt is not the same as automatic, though. What earns a live match its place is that this list
  // was ALREADY CARRYING IT as a fixture — not the mere fact that it is in play. So membership is
  // decided by the same rule as everything else, and only then lifted out of the count: the curated
  // leagues are a floor and are always in, while a live game outside them qualifies only when the
  // curated fixtures do not fill the list on their own — because that is exactly the case where it
  // would have held a slot an hour ago, when it was still the soonest kick-off in that half. Where
  // there is no room for it now there was none for it then, and it was never on the list to fall off.
  const trim = clampInt(searchParams.get("limit"), 0, 500);
  if (trim && searchParams.get("tier") === "priority") {
    const byWhen = function (list) {
      return list.slice().sort(function (a, b) {
        var ra = rank(a.status), rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        return ra === 2 ? ((b.ts || 0) - (a.ts || 0)) : ((a.ts || 0) - (b.ts || 0));
      });
    };
    const inPlay = feed.filter(function (m) { return m.status === "live"; });
    const later = feed.filter(function (m) { return m.status !== "live"; });
    const top = byWhen(later.filter(function (m) { return PRIORITY_RANK[m.leagueId] != null; }));
    const rest = byWhen(later.filter(function (m) { return PRIORITY_RANK[m.leagueId] == null; }));
    const roomBeyondCurated = top.length < trim;
    const live = inPlay.filter(function (m) { return PRIORITY_RANK[m.leagueId] != null || roomBeyondCurated; });
    const fixtures = top.length >= trim ? top.slice(0, trim) : top.concat(rest.slice(0, trim - top.length));
    const picked = byWhen(live.concat(fixtures));
    return jsonCached({ matches: picked }, 30, 120);
  }

  // 30s: the live half of this response is fetched on a 20s upstream cache, so a longer edge TTL
  // would just hold yesterday's minute. The app layers its own 45s cache on top of this.
  return jsonCached({ matches: feed }, 30, 120);
}