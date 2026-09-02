// app/api/predict/score/route.js — score prediction coupons for finished matches.
// Runs with the Supabase SERVICE ROLE (bypasses RLS) so it can write points to any user's row.
// Triggered lazily: when a finished match's coupon is opened, or as a sweep from the leaderboard.
//
// Scoring:
//   1X2 (Maç Sonucu) = 90 minutes only (score.fulltime) — extra time / penalties NOT counted.
//   1X2 correct = 3 ; MOTM (highest match rating) correct = 10 ;
//   each rating pick: |pred-actual| <= 0.2 -> 5, <= 0.5 -> 3, <= 1.0 -> 1, else 0
//   (a player who didn't play / has no rating is neutral: not counted).

const KEY = process.env.APISPORTS_KEY || "";
const HOST = "https://v3.football.api-sports.io";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const READY = !!(KEY && SB_URL && SB_KEY);

const FINISHED = { FT: 1, AET: 1, PEN: 1 };

function sbHdr(extra) { return Object.assign({ apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }, extra || {}); }
async function apiGet(path) {
  try {
    const r = await fetch(HOST + path, { headers: { "x-apisports-key": KEY } });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.response) || null;
  } catch (e) { return null; }
}

function scoreCoupon(picks, actual) {
  picks = picks || {};
  let pts = 0;
  if (picks.onextwo && actual.onextwo && picks.onextwo === actual.onextwo) pts += 3;
  if (picks.motm && picks.motm.id != null && actual.motmId != null && String(picks.motm.id) === String(actual.motmId)) pts += 10;
  (picks.ratings || []).forEach(function (r) {
    const a = actual.ratings[String(r.id)];
    if (a == null) return; // didn't play / no rating -> neutral
    const d = Math.abs(Number(r.pred) - a);
    pts += d <= 0.2 ? 5 : d <= 0.5 ? 3 : d <= 1.0 ? 1 : 0;
  });
  return pts;
}

async function fetchActual(matchId) {
  const fx = await apiGet("/fixtures?id=" + matchId);
  const item = fx && fx[0];
  if (!item || !item.fixture || !item.fixture.status || !FINISHED[item.fixture.status.short]) return null; // not finished yet
  const ft = (item.score && item.score.fulltime) || item.goals || {};
  let onextwo = null;
  if (ft.home != null && ft.away != null) onextwo = ft.home > ft.away ? "1" : (ft.home < ft.away ? "2" : "X");
  const pdata = await apiGet("/fixtures/players?fixture=" + matchId);
  const ratings = {}; let motmId = null, motmR = -1;
  (pdata || []).forEach(function (entry) {
    (entry.players || []).forEach(function (pp) {
      const p = pp.player || {};
      const g = ((pp.statistics && pp.statistics[0]) || {}).games || {};
      if (g.rating == null) return;
      const rv = parseFloat(g.rating);
      if (isNaN(rv)) return;
      ratings[String(p.id)] = rv;
      if (rv > motmR) { motmR = rv; motmId = p.id; }
    });
  });
  // hadRatings: were player ratings available? If not, we score the 1X2 now but keep re-scoring
  // later (rated=false) so the rating/MOTM points aren't lost to an early scoring pass.
  return { onextwo: onextwo, motmId: motmId, ratings: ratings, hadRatings: Object.keys(ratings).length > 0 };
}

async function scoreMatch(matchId) {
  // score coupons that are unscored OR were scored before ratings were available (rated=false)
  const r = await fetch(SB_URL + "/rest/v1/predictions?match_id=eq." + encodeURIComponent(matchId) + "&or=(scored.eq.false,rated.eq.false)&select=id,picks", { headers: sbHdr() });
  if (!r.ok) return 0;
  const rows = await r.json();
  if (!rows || !rows.length) return 0;
  const actual = await fetchActual(matchId);
  if (!actual) return 0; // match not finished / no data -> leave unscored
  let n = 0;
  for (const row of rows) {
    const pts = scoreCoupon(row.picks || {}, actual);
    const up = await fetch(SB_URL + "/rest/v1/predictions?id=eq." + row.id, {
      method: "PATCH", headers: sbHdr({ Prefer: "return=minimal" }),
      body: JSON.stringify({ points: pts, scored: true, rated: actual.hadRatings }),
    });
    if (up.ok) n++;
  }
  return n;
}

// sweep: score past-due coupons that are unscored or not-yet-rated (capped) — used from the leaderboard
async function sweep() {
  const nowIso = new Date().toISOString();
  const r = await fetch(SB_URL + "/rest/v1/predictions?match_ts=lt." + encodeURIComponent(nowIso) + "&or=(scored.eq.false,rated.eq.false)&select=match_id&limit=1000", { headers: sbHdr() });
  if (!r.ok) return 0;
  const rows = await r.json();
  const ids = Array.from(new Set((rows || []).map(function (x) { return x.match_id; }))).slice(0, 50);
  let n = 0;
  for (const id of ids) n += await scoreMatch(id);
  return n;
}

async function run(request) {
  if (!READY) return Response.json({ error: "not_configured", scored: 0 });
  const match = new URL(request.url).searchParams.get("match");
  if (match && !/^\d{1,12}$/.test(match)) return Response.json({ error: "bad_param", scored: 0 }, { status: 400 });
  // The sweep (up to 50 Supabase reads + 100 uncached upstream calls) is the cron's job now —
  // see cron-worker.js. Public callers may only score ONE named match (2 Sep audit: every web
  // page load used to trigger a full sweep, and so could anyone else, for free).
  if (!match) {
    const secret = process.env.FAN_ANALYSIS_SECRET || "";
    const given = request.headers.get("x-warm-secret") || "";
    if (!secret || given !== secret) return Response.json({ error: "forbidden", scored: 0 }, { status: 403 });
  }
  try {
    const scored = match ? await scoreMatch(match) : await sweep();
    return Response.json({ scored: scored });
  } catch (e) { return Response.json({ error: "failed", scored: 0 }); }
}

export async function GET(request) { return run(request); }
export async function POST(request) { return run(request); }
