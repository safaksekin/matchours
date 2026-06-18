// app/api/football/route.js
// football-data.org v4 (free tier). Key in .env.local as FOOTBALL_DATA_KEY=...
// Free tier gives: matches, standings (incl. form), scorers, head2head. (No lineups/match-stats.)

const HOST = "https://api.football-data.org/v4";

const COMPS = [
  { code: "WC",  name: "World Cup 2026" },
  { code: "CL",  name: "Champions League" },
  { code: "PL",  name: "Premier League" },
  { code: "PD",  name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA",  name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
];

function hdr() { return { "X-Auth-Token": process.env.FOOTBALL_DATA_KEY || "" }; }

async function apiGet(path, revalidate) {
  try {
    const res = await fetch(HOST + path, { headers: hdr(), next: { revalidate: revalidate || 60 } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function fmt(iso) {
  const d = new Date(iso);
  return {
    time: d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
    date: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }),
  };
}
function statusOf(s) {
  if (["IN_PLAY", "PAUSED", "LIVE"].includes(s)) return "live";
  if (["FINISHED", "AWARDED"].includes(s)) return "finished";
  return "upcoming";
}
function parseForm(formStr) {
  if (!formStr) return [];
  return formStr.indexOf(",") >= 0 ? formStr.split(",") : formStr.split("");
}

function mapMatch(m, comp) {
  const f = fmt(m.utcDate);
  const ft = (m.score && m.score.fullTime) || {};
  const hasScore = ft.home != null && ft.away != null;
  const ref = (m.referees && m.referees[0] && m.referees[0].name) || "—";
  return {
    id: String(m.id),
    comp: comp.code,
    homeId: m.homeTeam && m.homeTeam.id,
    awayId: m.awayTeam && m.awayTeam.id,
    home: (m.homeTeam && m.homeTeam.shortName) || (m.homeTeam && m.homeTeam.name) || "?",
    away: (m.awayTeam && m.awayTeam.shortName) || (m.awayTeam && m.awayTeam.name) || "?",
    homeLogo: (m.homeTeam && m.homeTeam.crest) || null,
    awayLogo: (m.awayTeam && m.awayTeam.crest) || null,
    time: f.time, date: f.date,
    league: comp.name,
    matchday: m.matchday || null,
    stage: m.stage || null,
    status: statusOf(m.status),
    score: hasScore ? (ft.home + " - " + ft.away) : null,
    stats: {
      referee: ref,
      stadium: m.venue || "—",
      city: (m.area && m.area.name) || "—",
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

  if (!process.env.FOOTBALL_DATA_KEY) return Response.json({ error: "no_key", matches: [] });

  // ── Standings (form + rank + points) for one competition ──
  if (mode === "standings") {
    const comp = searchParams.get("comp");
    const data = await apiGet("/competitions/" + comp + "/standings", 300);
    const map = {};
    if (data && data.standings) {
      data.standings.forEach(function (group) {
        if (group.type && group.type !== "TOTAL") return; // use the overall table
        (group.table || []).forEach(function (row) {
          map[row.team.id] = {
            form: parseForm(row.form),
            rank: row.position,
            points: row.points,
            won: row.won, draw: row.draw, lost: row.lost,
          };
        });
      });
    }
    return Response.json({ standings: map });
  }

  // ── Top scorers for one competition ──
  if (mode === "scorers") {
    const comp = searchParams.get("comp");
    const data = await apiGet("/competitions/" + comp + "/scorers?limit=10", 600);
    const list = [];
    if (data && data.scorers) {
      data.scorers.forEach(function (s) {
        list.push({
          name: (s.player && s.player.name) || "?",
          team: (s.team && (s.team.shortName || s.team.name)) || "",
          goals: s.goals != null ? s.goals : 0,
          assists: s.assists != null ? s.assists : null,
        });
      });
    }
    return Response.json({ scorers: list });
  }

  // ── Head to head ──
  if (mode === "h2h") {
    const matchId = searchParams.get("match");
    const data = await apiGet("/matches/" + matchId + "/head2head?limit=20", 300);
    if (data && data.aggregates) {
      const a = data.aggregates;
      return Response.json({ h2h: {
        total: a.numberOfMatches || 0,
        homeWins: (a.homeTeam && a.homeTeam.wins) || 0,
        awayWins: (a.awayTeam && a.awayTeam.wins) || 0,
        draws: (a.homeTeam && a.homeTeam.draws) || 0,
      }});
    }
    return Response.json({ h2h: { total: 0, homeWins: 0, awayWins: 0, draws: 0 } });
  }

  // ── Recent form: last 5 finished matches (with scores) for both teams ──
  if (mode === "recent") {
    const homeId = searchParams.get("home");
    const awayId = searchParams.get("away");

    async function lastFive(teamId) {
      if (!teamId) return [];
      const data = await apiGet("/teams/" + teamId + "/matches?status=FINISHED&limit=5", 300);
      const out = [];
      if (data && data.matches) {
        // API returns ascending; take the most recent 5 and reverse to newest-first
        const ms = data.matches.slice(-5).reverse();
        ms.forEach(function (m) {
          const ft = (m.score && m.score.fullTime) || {};
          if (ft.home == null || ft.away == null) return;
          const isHome = m.homeTeam && String(m.homeTeam.id) === String(teamId);
          const my = isHome ? ft.home : ft.away;
          const opp = isHome ? ft.away : ft.home;
          let result = "D";
          if (my > opp) result = "W";
          else if (my < opp) result = "L";
          const oppName = isHome
            ? ((m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "?")
            : ((m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "?");
          out.push({ result: result, score: my + "-" + opp, opp: oppName, home: isHome });
        });
      }
      return out;
    }

    const home = await lastFive(homeId);
    const away = await lastFive(awayId);
    return Response.json({ recent: { home: home, away: away } });
  }

  // ── List: live + upcoming + recently finished (yesterday → +14 days) ──
  const today = new Date();
  const from = new Date(today); from.setDate(today.getDate() - 1);
  const to = new Date(today); to.setDate(today.getDate() + 30);
  const dFrom = from.toISOString().split("T")[0];
  const dTo = to.toISOString().split("T")[0];

  const all = [];
  for (const c of COMPS) {
    // no status filter -> returns SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED in the window
    const data = await apiGet(
      "/competitions/" + c.code + "/matches?dateFrom=" + dFrom + "&dateTo=" + dTo,
      30 // refresh every 30s so live scores stay reasonably fresh
    );
    if (data && data.matches && data.matches.length) {
      data.matches.slice(0, 20).forEach(function (m) {
        all.push(mapMatch(m, c));
      });
    }
  }

  // order: live first, then upcoming, then finished
  function rank(s) { return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); }
  all.sort(function (a, b) { return rank(a.status) - rank(b.status); });

  return Response.json({ matches: all });
}