// app/api/football/route.js
// API-Football (api-sports.io) — direct access.
// .env.local:  APISPORTS_KEY=your_api_key_here

const HOST = "https://v3.football.api-sports.io";

// league id + season (season = starting year; 2025/26 -> 2025, World Cup 2026 -> 2026)
const LEAGUES = [
  { id: 1,   name: "World Cup",        season: 2026 },
  { id: 2,   name: "Champions League", season: 2025 },
  { id: 39,  name: "Premier League",   season: 2025 },
  { id: 140, name: "La Liga",          season: 2025 },
  { id: 135, name: "Serie A",          season: 2025 },
  { id: 78,  name: "Bundesliga",       season: 2025 },
  { id: 61,  name: "Ligue 1",          season: 2025 },
  { id: 203, name: "Super Lig",        season: 2025 },
];

function hdr() { return { "x-apisports-key": process.env.APISPORTS_KEY || "" }; }

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

async function apiGet(path, revalidate, _retried) {
  const ttl = revalidate || 60;
  const url = HOST + path;
  const edge = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  const key = edge ? new Request(url, { method: "GET" }) : null;
  if (!edge) { const m = memGet(url); if (m !== undefined) return m; } // dev cache hit
  try {
    if (edge) {
      const hit = await edge.match(key);
      if (hit) { const j = JSON.parse(await hit.text()); return j && j.response ? j.response : null; }
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
    }
    return resp;
  } catch (e) { return null; }
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

function statusOf(short) {
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  return "upcoming";
}

function ymd(d) {
  var m = ("0" + (d.getMonth() + 1)).slice(-2);
  var day = ("0" + d.getDate()).slice(-2);
  return d.getFullYear() + "-" + m + "-" + day;
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
    time: d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
    league: leagueName || (item.league && item.league.name) || "",
    leagueId: item.league && item.league.id,
    season: item.league && item.league.season,
    status: statusOf(short),
    dateKey: ymd(d), ts: d.getTime(),
    minute: (fx.status && fx.status.elapsed) || null,
    score: hasScore ? (goals.home + " - " + goals.away) : null,
    stats: {
      referee: fx.referee || "—",
      stadium: (fx.venue && fx.venue.name) || "—",
      city: (fx.venue && fx.venue.city) || "—",
      homeForm: [], awayForm: [], homeRank: null, awayRank: null,
      homePoints: null, awayPoints: null,
      homeSquad: [], awaySquad: [], channels: [],
      h2h: { total: 0, homeWins: 0, awayWins: 0, draws: 0 }, comments: [],
    },
  };
}

export async function GET(request) {
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
        time: d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
        date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
      };
    }

    try {
      // games endpoints accept ?date=; mma fights we just take upcoming list
      const url = cfg.host + cfg.path + (sport === "mma" ? "?season=" + today.getFullYear() : "?date=" + dToday);
      const res = await fetch(url, { headers: hdr(), next: { revalidate: 300 } });
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

  // ── Search: team fixtures + players by name ──
  if (mode === "search") {
    const q = searchSafe(searchParams.get("q") || ""); // fold Turkish/accents; API needs ASCII
    if (q.length < 3) return Response.json({ matches: [], players: [] });

    // Players: API stores abbreviated first names ("E. Haaland", "A. Güler"), so the profile
    // search matches the surname best. For multi-word input search by the last token (surname),
    // then re-rank the candidates against ALL typed tokens so the right player isn't buried.
    const qTokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pq = qTokens.length > 1 ? qTokens[qTokens.length - 1] : q;
    const playerRaw = (pq.length >= 3)
      ? await apiGet("/players/profiles?search=" + encodeURIComponent(pq), 3600)
      : null;
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
      .map(function (p) { return { p: p, sc: pscore(p) }; })
      .sort(function (a, b) { if (b.sc !== a.sc) return b.sc - a.sc; return (a.p.id || 0) - (b.p.id || 0); })
      .slice(0, 25)
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

    const teamFull = await apiGet("/teams?search=" + encodeURIComponent(q), 3600);
    // rank every matching team so partial queries surface suggestions ("milan" -> Milan; "real" -> Real Madrid/Sociedad/Betis...)
    const teamRanked = [];
    (teamFull || []).forEach(function (it) {
      const tt = it.team || {};
      const nm = searchSafe(tt.name || "").toLowerCase();
      if (!nm) return;
      let s = 0;
      if (nm === ql || nm.indexOf(ql) === 0) s = 3; // exact OR starts-with (id breaks ties -> well-known clubs first)
      else if (nm.indexOf(ql) >= 0) s = 2;          // contains the query
      else if (ql.indexOf(nm) >= 0) s = 1;          // query contains the name
      if (s <= 0) return;
      if (isVariant(tt.name)) s -= 2;
      if (s > 0) teamRanked.push({ t: tt, s: s });
    });
    teamRanked.sort(function (a, b) { if (b.s !== a.s) return b.s - a.s; return (a.t.id || 0) - (b.t.id || 0); });
    const topTeams = teamRanked.slice(0, 6).map(function (x) { return x.t; });
    // enter single-team mode (and skip H2H) only when the top match is strong (contains / prefix / exact)
    let single = (teamRanked.length && teamRanked[0].s >= 2) ? teamRanked[0].t : null;

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

    return Response.json({ teams: teamsOut, matches: matchesOut, players: players });
  }

  // ── Player season stats + trophies (Sofascore-style profile page) ──
  if (mode === "player") {
    const id = searchParams.get("id");
    const season = searchParams.get("season") || 2025;
    if (!id) return Response.json({ player: null });

    const statData = await apiGet("/players?id=" + id + "&season=" + season, 1800);
    const trophyData = await apiGet("/trophies?player=" + id, 86400);

    const trophies = (trophyData || []).map(function (tr) {
      return { league: tr.league || "", country: tr.country || "", season: tr.season || "", place: tr.place || "" };
    });
    let trophiesWon = 0;
    trophies.forEach(function (tr) { if ((tr.place || "").toLowerCase() === "winner") trophiesWon++; });

    const entry = (statData && statData[0]) ? statData[0] : null;

    // no season stats: still show a basic profile card from /players/profiles
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
    let apps = 0, goals = 0, assists = 0, minutes = 0, yellow = 0, red = 0;
    let ratingSum = 0, ratingW = 0;
    const competitions = [];
    stats.forEach(function (s) {
      const g = s.games || {};
      const go = s.goals || {};
      const cd = s.cards || {};
      const a = g.appearences || 0; // API spells it "appearences"
      apps += a;
      goals += go.total || 0;
      assists += go.assists || 0;
      minutes += g.minutes || 0;
      yellow += cd.yellow || 0;
      red += (cd.red || 0) + (cd.yellowred || 0);
      if (g.rating != null) { const rv = parseFloat(g.rating); if (!isNaN(rv)) { ratingSum += rv * (a || 1); ratingW += (a || 1); } }
      competitions.push({
        league: (s.league && s.league.name) || "",
        leagueLogo: (s.league && s.league.logo) || null,
        team: (s.team && s.team.name) || "",
        teamLogo: (s.team && s.team.logo) || null,
        appearances: a,
        goals: go.total || 0,
        assists: go.assists || 0,
        rating: g.rating != null ? Math.round(parseFloat(g.rating) * 100) / 100 : null,
      });
    });
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
        position: (primary.games && primary.games.position) || p.position || null,
        team: { name: (primary.team && primary.team.name) || null, logo: (primary.team && primary.team.logo) || null },
        season: parseInt(season, 10),
        totals: {
          appearances: apps, goals: goals, assists: assists, minutes: minutes,
          yellow: yellow, red: red,
          rating: ratingW > 0 ? Math.round(ratingSum / ratingW * 100) / 100 : null,
        },
        competitions: competitions,
        trophies: trophies,
        trophiesWon: trophiesWon,
      },
    });
  }

  // ── Team profile: info + venue + domestic-season stats + rank + fixtures ──
  if (mode === "team") {
    const id = searchParams.get("id");
    const season = searchParams.get("season") || 2025;
    if (!id) return Response.json({ team: null });

    const teamData = await apiGet("/teams?id=" + id, 86400);
    const entry = (teamData && teamData[0]) ? teamData[0] : null;
    if (!entry) return Response.json({ team: null });
    const tm = entry.team || {};
    const vn = entry.venue || {};

    // pick the domestic league (type "League") this season for stats + standings
    const leaguesData = await apiGet("/leagues?team=" + id + "&season=" + season, 3600);
    let domestic = null;
    (leaguesData || []).forEach(function (lx) {
      if (!domestic && lx.league && lx.league.type === "League") domestic = lx.league;
    });

    let stats = null;
    let league = null;
    if (domestic) {
      let rank = null, points = null;
      const sd = await apiGet("/teams/statistics?team=" + id + "&league=" + domestic.id + "&season=" + season, 1800);
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
      const stData = await apiGet("/standings?league=" + domestic.id + "&season=" + season, 600);
      if (stData && stData[0] && stData[0].league && stData[0].league.standings) {
        stData[0].league.standings.forEach(function (group) {
          (group || []).forEach(function (row) {
            if (row.team && String(row.team.id) === String(id)) { rank = row.rank; points = row.points; }
          });
        });
      }
      league = { id: domestic.id, name: domestic.name, logo: domestic.logo, rank: rank, points: points };
    }

    const upcoming = await apiGet("/fixtures?team=" + id + "&next=5", 120);
    const recent = await apiGet("/fixtures?team=" + id + "&last=5", 300);
    const fixtures = [];
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
      const nameById = {};
      LEAGUES.forEach(function (l) { nameById[l.id] = l.name; });
      const out = [];
      (data || []).forEach(function (item) {
        const lid = item.league && item.league.id;
        if (!nameById[lid]) return; // only our tracked leagues
        out.push(mapFixture(item, nameById[lid]));
      });
      const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
      out.sort(function (a, b) { return rank(a.status) - rank(b.status); });
      return Response.json({ matches: out });
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
          time: d ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "",
          date: d ? d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }) : "",
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
    const nameById = {};
    LEAGUES.forEach(function (l) { nameById[l.id] = l.name; });
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
    for (const fx of fixtures) {
      const pdata = await apiGet("/fixtures/players?fixture=" + fx.fixture.id, 600);
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
    }
    all.sort(function (a, b) { return b.rating - a.rating; });
    return Response.json({ players: all.slice(0, 3), date: chosen });
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
      const from = new Date(today); from.setDate(today.getDate() - 3);
      const to = new Date(today); to.setDate(today.getDate() + 30);
      const dFrom = from.toISOString().split("T")[0];
      const dTo = to.toISOString().split("T")[0];
      let data = await apiGet("/fixtures?league=" + league + "&season=" + season + "&from=" + dFrom + "&to=" + dTo, 60);
      if (!data || !data.length) data = await apiGet("/fixtures?league=" + league + "&season=" + season + "&last=20", 120);
      // current season not started yet -> show last season's recent matches
      if (!data || !data.length) data = await apiGet("/fixtures?league=" + league + "&season=" + (parseInt(season, 10) - 1) + "&last=20", 600);
      const out = (data || []).slice(0, 40).map(function (item) { return mapFixture(item, item.league && item.league.name); });
      const rank = function (s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
      out.sort(function (a, b) { return rank(a.status) - rank(b.status); });
      return Response.json({ matches: out });
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
          time: d ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "",
          date: d ? d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }) : "",
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
    let data = await apiGet("/standings?league=" + leagueId + "&season=" + season, 300);
    // current season has no table yet -> fall back to previous season
    if (!data || !data[0] || !data[0].league || !data[0].league.standings) {
      data = await apiGet("/standings?league=" + leagueId + "&season=" + (parseInt(season, 10) - 1), 600);
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
        date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }),
        ts: item.fixture.date,
        home: item.teams.home.name,
        away: item.teams.away.name,
        score: g.home + " - " + g.away,
        league: (item.league && item.league.name) || "",
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

    // Keep per-match api calls low (rate limits): core 4 always, the rest only pre-match.
    const lineupData = await apiGet("/fixtures/lineups?fixture=" + fixtureId, 600);
    const statsData = await apiGet("/fixtures/statistics?fixture=" + fixtureId, 120);
    const eventsData = await apiGet("/fixtures/events?fixture=" + fixtureId, 120);
    const playersData = await apiGet("/fixtures/players?fixture=" + fixtureId, 120);
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
        coach: (entry.coach && entry.coach.name) || null,
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
        assist: (ev.assist && ev.assist.name) || "",
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
          goals: goals.total || 0,
          assists: goals.assists || 0,
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

    return Response.json({
      detail: {
        lineups: { home: homeLU, away: awayLU },
        stats: { home: homeStats, away: awayStats },
        subs: subs,
        colors: { home: homeLU.color, away: awayLU.color },
        timeline: timeline,
        injuries: injuries,
        season: { home: homeSeason, away: awaySeason },
        playerStats: { home: homePlayers, away: awayPlayers },
      },
    });
  }

  // ── List: live + upcoming + recent finished ──
  const today = new Date();
  const from = new Date(today); from.setDate(today.getDate() - 1);
  const to = new Date(today); to.setDate(today.getDate() + 30);
  const dFrom = from.toISOString().split("T")[0];
  const dTo = to.toISOString().split("T")[0];

  const all = [];
  const seen = {};
  function add(item, leagueName) {
    var id = String(item.fixture.id);
    if (seen[id]) return;
    seen[id] = true;
    all.push(mapFixture(item, leagueName));
  }

  // 1) live matches across our leagues (fresh, short cache)
  const leagueIds = LEAGUES.map(function (l) { return l.id; }).join("-");
  const liveData = await apiGet("/fixtures?live=" + leagueIds, 20);
  const nameById = {};
  LEAGUES.forEach(function (l) { nameById[l.id] = l.name; });
  if (liveData && liveData.length) {
    liveData.forEach(function (item) {
      var lid = item.league && item.league.id;
      add(item, nameById[lid] || (item.league && item.league.name));
    });
  }

  // 2) upcoming + recent per league
  for (const lg of LEAGUES) {
    const data = await apiGet(
      "/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + dFrom + "&to=" + dTo,
      300
    );
    if (data && data.length) {
      data.slice(0, 20).forEach(function (item) { add(item, lg.name); });
    }
  }

  function rank(s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); }
  all.sort(function (a, b) {
    var r = rank(a.status) - rank(b.status);
    return r;
  });

  return Response.json({ matches: all });
}