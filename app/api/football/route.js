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

async function apiGet(path, revalidate) {
  try {
    const res = await fetch(HOST + path, { headers: hdr(), next: { revalidate: revalidate || 60 } });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.response ? j.response : null;
  } catch (e) { return null; }
}

function statusOf(short) {
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  return "upcoming";
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
    const data = await apiGet("/standings?league=" + leagueId + "&season=" + season, 300);
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
    const data = await apiGet("/players/topscorers?league=" + leagueId + "&season=" + season, 600);
    const list = [];
    (data || []).slice(0, 10).forEach(function (p) {
      const st = (p.statistics && p.statistics[0]) || {};
      list.push({
        name: p.player.name,
        team: (st.team && st.team.name) || "",
        goals: (st.goals && st.goals.total) || 0,
      });
    });
    return Response.json({ scorers: list });
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

  // ── Detail: lineups + statistics + substitutions ──
  if (mode === "detail") {
    const fixtureId = searchParams.get("match");

    const lineupData = await apiGet("/fixtures/lineups?fixture=" + fixtureId, 120);
    const statsData = await apiGet("/fixtures/statistics?fixture=" + fixtureId, 60);
    const eventsData = await apiGet("/fixtures/events?fixture=" + fixtureId, 60);

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
          };
        });
      }
      // jersey color from API: team.colors.player.primary (hex without '#')
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

    // substitutions: for type "subst" -> player = OUT, assist = IN
    const subs = []; // { teamId, outId, outName, inId, inName, minute }
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

    const homeLU = lineupData && lineupData[0] ? sideLineup(lineupData[0]) : sideLineup(null);
    const awayLU = lineupData && lineupData[1] ? sideLineup(lineupData[1]) : sideLineup(null);
    const homeStats = statsData && statsData[0] ? sideStats(statsData[0]) : null;
    const awayStats = statsData && statsData[1] ? sideStats(statsData[1]) : null;

    return Response.json({
      detail: {
        lineups: { home: homeLU, away: awayLU },
        stats: { home: homeStats, away: awayStats },
        subs: subs,
        colors: { home: homeLU.color, away: awayLU.color },
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
  for (const lg of LEAGUES) {
    const data = await apiGet(
      "/fixtures?league=" + lg.id + "&season=" + lg.season + "&from=" + dFrom + "&to=" + dTo,
      30
    );
    if (data && data.length) {
      data.slice(0, 20).forEach(function (item) { all.push(mapFixture(item, lg.name)); });
    }
  }

  function rank(s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); }
  all.sort(function (a, b) { return rank(a.status) - rank(b.status); });

  return Response.json({ matches: all });
}