// app/lib/db.js — thin data-access helpers over Supabase for ratings & comments.
// RLS enforces "read all, write only your own", so these just shape the payloads.
import { supabase } from "./supabaseClient";

export async function getUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data && data.user ? data.user.id : null;
  } catch (e) { return null; }
}

// ── Username (profiles) ─────────────────────────────────────────────────────
export async function fetchMyUsername() {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase.from("profiles").select("username").eq("id", uid).single();
  return data ? data.username : null;
}
export async function updateUsername(username) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const clean = String(username || "").trim();
  if (clean.length < 2) return { error: "too_short" };
  const { error } = await supabase.from("profiles").update({ username: clean }).eq("id", uid);
  return { error: error || null };
}

// The signed-in user's own comments (+ total count) for the profile page.
export async function fetchMyComments(limit) {
  const uid = await getUserId();
  if (!uid) return { count: 0, items: [] };
  const { data, count } = await supabase.from("comments")
    .select("*", { count: "exact" })
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit || 6);
  return { count: count || 0, items: data || [] };
}

// ── Favorites (teams & players) ─────────────────────────────────────────────
export async function fetchFavorites() {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await supabase.from("favorites")
    .select("kind, ref_id, name, image, meta, created_at")
    .order("created_at", { ascending: false });
  return data || [];
}
export async function addFavorite(f) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const { error } = await supabase.from("favorites").insert({
    user_id: uid, kind: f.kind, ref_id: String(f.ref_id),
    name: f.name || null, image: f.image || null, meta: f.meta || null,
  });
  return { error: error || null };
}
export async function removeFavorite(kind, refId) {
  const uid = await getUserId();
  if (!uid) return;
  await supabase.from("favorites").delete().eq("user_id", uid).eq("kind", kind).eq("ref_id", String(refId));
}

// ── Ratings ───────────────────────────────────────────────────────────────
// The current user's existing rating for a target (so the sheet opens pre-filled).
export async function fetchMyRating(opts) {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase.from("ratings").select("rating")
    .eq("user_id", uid)
    .eq("target_type", opts.targetType)
    .eq("target_id", String(opts.targetId))
    .eq("match_id", String(opts.matchId))
    .maybeSingle();
  return data ? Number(data.rating) : null;
}

// Insert-or-update the user's rating (unique on user+target+match -> upsert).
export async function saveRating(opts) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const { error } = await supabase.from("ratings").upsert({
    user_id: uid,
    target_type: opts.targetType,
    target_id: String(opts.targetId),
    match_id: String(opts.matchId),
    target_name: opts.targetName || null,
    sport: opts.sport || "football",
    rating: opts.rating,
  }, { onConflict: "user_id,target_type,target_id,match_id" });
  return { error: error || null };
}

// ── Comments ──────────────────────────────────────────────────────────────
// Comments for a target, newest first, with each commenter's username resolved.
export async function fetchComments(opts) {
  let q = supabase.from("comments").select("id, body, created_at, user_id")
    .eq("target_type", opts.targetType)
    .eq("target_id", String(opts.targetId))
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts.matchId != null) q = q.eq("match_id", String(opts.matchId));
  const { data } = await q;
  const rows = data || [];
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map(function (r) { return r.user_id; })));
  const { data: profs } = await supabase.from("profiles").select("id, username").in("id", ids);
  const nameById = {};
  (profs || []).forEach(function (p) { nameById[p.id] = p.username; });
  return rows.map(function (r) {
    return { id: r.id, text: r.body, created_at: r.created_at, user: nameById[r.user_id] || "kullanıcı", user_id: r.user_id };
  });
}

// All comments on a match — matched by target_id OR match_id so nobody's comment is missed
// regardless of how its fields were stored.
export async function fetchMatchComments(matchId) {
  const id = String(matchId);
  const { data } = await supabase.from("comments").select("id, body, created_at, user_id")
    .eq("target_type", "match")
    .or("target_id.eq." + id + ",match_id.eq." + id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = data || [];
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map(function (r) { return r.user_id; })));
  const { data: profs } = await supabase.from("profiles").select("id, username").in("id", ids);
  const nameById = {};
  (profs || []).forEach(function (p) { nameById[p.id] = p.username; });
  return rows.map(function (r) {
    return { id: r.id, text: r.body, created_at: r.created_at, user: nameById[r.user_id] || "kullanıcı", user_id: r.user_id };
  });
}

// Comment counts for a batch of matches in ONE query, so every match card can show its
// real count without a query per card. A comment counts toward a match if its match_id is
// the match, or it's a match-level comment whose target_id is the match.
export async function fetchCommentCounts(matchIds) {
  const ids = Array.from(new Set((matchIds || []).map(String).filter(Boolean)));
  if (!ids.length) return {};
  const list = ids.join(",");
  const { data } = await supabase.from("comments")
    .select("id, target_id, match_id, target_type")
    .or("match_id.in.(" + list + "),and(target_type.eq.match,target_id.in.(" + list + "))");
  const set = new Set(ids);
  const counts = {};
  (data || []).forEach(function (r) {
    let key = (r.match_id != null && set.has(String(r.match_id))) ? String(r.match_id)
            : (set.has(String(r.target_id)) ? String(r.target_id) : null);
    if (key == null) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// All comments, newest first, with usernames — for the community/forum feed.
export async function fetchCommunityFeed(limit) {
  const { data } = await supabase.from("comments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit || 60);
  const rows = data || [];
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map(function (r) { return r.user_id; })));
  const { data: profs } = await supabase.from("profiles").select("id, username").in("id", ids);
  const nameById = {};
  (profs || []).forEach(function (p) { nameById[p.id] = p.username; });
  return rows.map(function (r) { return Object.assign({}, r, { user: nameById[r.user_id] || "kullanıcı" }); });
}

export async function addComment(opts) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const base = {
    user_id: uid,
    target_type: opts.targetType,
    target_id: String(opts.targetId),
    match_id: opts.matchId != null ? String(opts.matchId) : null,
    target_name: opts.targetName || null,
    sport: opts.sport || "football",
    body: opts.body,
  };
  const extras = { match_name: opts.matchName || null, meta: opts.meta || null };
  let res = await supabase.from("comments")
    .insert(Object.assign({}, base, extras))
    .select("id, body, created_at, user_id").single();
  // Older DBs without the match_name / meta columns: retry without them so commenting never breaks.
  if (res.error && /match_name|meta|column/i.test(String(res.error.message || ""))) {
    res = await supabase.from("comments").insert(base).select("id, body, created_at, user_id").single();
  }
  return { data: res.data || null, error: res.error || null };
}

// ── Predictions & reputation ────────────────────────────────────────────────
// Save (or replace before kickoff) this user's coupon for a match. One row per user+match.
export async function savePrediction(opts) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const row = {
    user_id: uid,
    match_id: String(opts.matchId),
    match_ts: opts.matchTs || null,
    league_id: opts.leagueId != null ? String(opts.leagueId) : null,
    sport: opts.sport || "football",
    picks: opts.picks || {},
    meta: opts.meta || null,
    scored: false,
    points: null,
  };
  const { data, error } = await supabase.from("predictions")
    .upsert(row, { onConflict: "user_id,match_id" })
    .select("*").single();
  return { data: data || null, error: error || null };
}

// Delete this user's coupon for a match (used to cancel a prediction before kickoff).
export async function deletePrediction(matchId) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const { error } = await supabase.from("predictions").delete().eq("user_id", uid).eq("match_id", String(matchId));
  return { error: error || null };
}

// This user's coupon for a match (null if none yet).
export async function fetchMyPrediction(matchId) {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase.from("predictions")
    .select("*").eq("user_id", uid).eq("match_id", String(matchId)).maybeSingle();
  return data || null;
}

// How many people predicted each match (batched, for the match-list "predictors" badge).
export async function fetchPredictionCounts(matchIds) {
  const ids = Array.from(new Set((matchIds || []).map(String).filter(Boolean)));
  if (!ids.length) return {};
  const { data, error } = await supabase.rpc("match_prediction_counts", { p_matches: ids });
  if (error) return {};
  const map = {};
  (data || []).forEach(function (r) { map[String(r.match_id)] = Number(r.cnt); });
  return map;
}

// This user's coupons for a batch of matches (for the quick 1X2 on feed cards). Keyed by match_id.
export async function fetchMyPredictionsFor(matchIds) {
  const uid = await getUserId();
  if (!uid) return {};
  const ids = Array.from(new Set((matchIds || []).map(String).filter(Boolean)));
  if (!ids.length) return {};
  const { data } = await supabase.from("predictions")
    .select("*").eq("user_id", uid).in("match_id", ids);
  const map = {};
  (data || []).forEach(function (r) { map[String(r.match_id)] = r; });
  return map;
}

// This user's coupons (newest first) + total reputation points, for the profile / "my predictions".
export async function fetchMyPredictions(limit) {
  const uid = await getUserId();
  if (!uid) return { items: [], points: 0, played: 0 };
  const { data } = await supabase.from("predictions")
    .select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(limit || 50);
  const rows = data || [];
  let points = 0, played = 0;
  rows.forEach(function (r) { if (r.scored) { points += r.points || 0; played += 1; } });
  return { items: rows, points: points, played: played };
}

// Community average player rating for a match (for the post-match consensus box).
export async function fetchRatingConsensus(matchId) {
  const { data, error } = await supabase.rpc("match_rating_consensus", { p_match: String(matchId) });
  if (error) return {};
  const map = {};
  (data || []).forEach(function (r) { map[String(r.target_id)] = { avg: Number(r.avg_rating), cnt: Number(r.cnt) }; });
  return map;
}
// The user's rating fingerprint for Football DNA (count + avg + divergence from the community).
export async function fetchUserRatingProfile(userId) {
  const uid = userId || (await getUserId());
  if (!uid) return null;
  const { data, error } = await supabase.rpc("user_rating_profile", { p_user: uid });
  if (error || !data || !data[0]) return { n: 0, avg_rating: null, avg_diff: null, avg_absdiff: null };
  const r = data[0];
  return { n: Number(r.n) || 0, avg_rating: r.avg_rating != null ? Number(r.avg_rating) : null,
    avg_diff: r.avg_diff != null ? Number(r.avg_diff) : null, avg_absdiff: r.avg_absdiff != null ? Number(r.avg_absdiff) : null };
}

// Players this user has rated the most — the Scout collection (count + avg per player).
export async function fetchMyRatedPlayers(limit) {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await supabase.from("ratings").select("target_id, target_name, rating")
    .eq("user_id", uid).eq("target_type", "player").limit(2000);
  const map = {};
  (data || []).forEach(function (r) {
    const k = String(r.target_id);
    if (!map[k]) map[k] = { id: k, name: r.target_name, n: 0, sum: 0 };
    map[k].n += 1; map[k].sum += Number(r.rating);
  });
  const arr = Object.keys(map).map(function (k) { return { id: map[k].id, name: map[k].name, n: map[k].n, avg: map[k].sum / map[k].n }; });
  arr.sort(function (a, b) { return b.n - a.n || b.avg - a.avg; });
  return arr.slice(0, limit || 30);
}

// This user's own player ratings for a match (target_id -> {rating, name}).
export async function fetchMyMatchRatings(matchId) {
  const uid = await getUserId();
  if (!uid) return {};
  const { data } = await supabase.from("ratings").select("target_id, target_name, rating")
    .eq("user_id", uid).eq("match_id", String(matchId)).eq("target_type", "player");
  const map = {};
  (data || []).forEach(function (r) { map[String(r.target_id)] = { rating: Number(r.rating), name: r.target_name }; });
  return map;
}

// Leaderboard (global, or within a community league). weekly=true -> this week only.
export async function fetchPredLeaderboard(opts) {
  opts = opts || {};
  const fn = opts.leagueId ? "pred_leaderboard_league" : "pred_leaderboard_global";
  const args = opts.leagueId
    ? { p_league: opts.leagueId, p_weekly: !!opts.weekly, p_limit: opts.limit || 100 }
    : { p_weekly: !!opts.weekly, p_limit: opts.limit || 100 };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return [];
  return data || [];
}

// ── Community leagues ───────────────────────────────────────────────────────
function randomLeagueCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusable chars
  let s = ""; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
export async function createPredLeague(name) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const clean = String(name || "").trim();
  if (clean.length < 2) return { error: "too_short" };
  // retry a couple of times on the tiny chance the random code collides
  let last = null;
  for (let i = 0; i < 4; i++) {
    const code = randomLeagueCode();
    const { data, error } = await supabase.from("pred_leagues")
      .insert({ name: clean, code: code, owner_id: uid }).select("*").single();
    if (!error && data) {
      await supabase.from("pred_league_members").insert({ league_id: data.id, user_id: uid });
      return { data: data, error: null };
    }
    last = error;
    if (!/duplicate|unique|code/i.test(String((error && error.message) || ""))) break;
  }
  return { error: last || "failed" };
}
export async function joinPredLeague(code) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const clean = String(code || "").trim().toUpperCase();
  const { data: lg } = await supabase.from("pred_leagues").select("*").eq("code", clean).maybeSingle();
  if (!lg) return { error: "not_found" };
  const { error } = await supabase.from("pred_league_members")
    .upsert({ league_id: lg.id, user_id: uid }, { onConflict: "league_id,user_id" });
  return { data: lg, error: error || null };
}
export async function fetchMyPredLeagues() {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await supabase.from("pred_league_members")
    .select("league_id, pred_leagues(id, name, code, owner_id)")
    .eq("user_id", uid);
  return (data || []).map(function (r) { return r.pred_leagues; }).filter(Boolean);
}

// ── Match Log (the spine: match star + style tags; player ratings go to `ratings`) ──
// Insert-or-update this user's log for a match (unique on user+match -> upsert).
export async function saveMatchLog(opts) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const { error } = await supabase.from("match_logs").upsert({
    user_id: uid,
    match_id: String(opts.matchId),
    rating: opts.rating,
    tags: opts.tags || [],
    players: opts.players || [],
    attended: !!opts.attended,
    venue: opts.attended ? (opts.venue || null) : null,
    photo: opts.attended ? (opts.photo || null) : null,
    home: opts.home || null,
    away: opts.away || null,
    home_logo: opts.homeLogo || null,
    away_logo: opts.awayLogo || null,
    score: opts.score || null,
    league: opts.league || null,
    match_ts: opts.matchTs || null,
  }, { onConflict: "user_id,match_id" });
  return { error: error || null };
}

// This user's existing log for one match (or null).
export async function fetchMyMatchLog(matchId) {
  const uid = await getUserId();
  if (!uid) return null;
  const { data } = await supabase.from("match_logs").select("*")
    .eq("user_id", uid).eq("match_id", String(matchId)).maybeSingle();
  return data || null;
}

// Another user's logged matches (public read) — for their public profile / Taste Graph.
export async function fetchUserLogs(userId, limit) {
  if (!userId) return [];
  const { data } = await supabase.from("match_logs").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit || 80);
  return data || [];
}

// Another user's comments (public read) — for their public profile.
export async function fetchUserComments(userId, limit) {
  if (!userId) return [];
  const { data } = await supabase.from("comments").select("*")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit || 40);
  return data || [];
}

// Backfill crest/score onto older logs that were saved before those columns existed (own logs only).
// Fetches the fixtures' crests once, persists them, and returns the enriched list for immediate render.
export async function backfillLogLogos(logs) {
  const uid = await getUserId();
  const missing = (logs || []).filter(function (l) { return !l.home_logo && l.match_id; });
  if (!uid || !missing.length) return logs;
  const ids = Array.from(new Set(missing.map(function (l) { return String(l.match_id); }))).slice(0, 20);
  try {
    const res = await fetch("/api/football?mode=fixturemeta&ids=" + ids.join(","));
    const j = await res.json();
    const meta = (j && j.meta) || {};
    const updates = [];
    logs.forEach(function (l) {
      const m = meta[String(l.match_id)];
      if (m && !l.home_logo) {
        l.home_logo = m.homeLogo; l.away_logo = m.awayLogo; if (!l.score) l.score = m.score;
        updates.push(supabase.from("match_logs").update({ home_logo: m.homeLogo, away_logo: m.awayLogo, score: l.score }).eq("user_id", uid).eq("match_id", String(l.match_id)));
      }
    });
    await Promise.all(updates);
  } catch (e) {}
  return logs;
}

// This user's logged matches, newest first — the diary / Taste-Graph source.
export async function fetchMyLogs(limit) {
  const uid = await getUserId();
  if (!uid) return [];
  const { data } = await supabase.from("match_logs").select("*")
    .eq("user_id", uid).order("created_at", { ascending: false }).limit(limit || 80);
  return data || [];
}

// Upload one stadium photo for a log → returns its public URL. Path is user-scoped for RLS.
export async function uploadLogPhoto(matchId, file) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const ext = ((file && file.name && file.name.split(".").pop()) || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = uid + "/" + String(matchId) + "-" + Date.now() + "." + ext;
  const up = await supabase.storage.from("log-photos").upload(path, file, { upsert: true, contentType: (file && file.type) || "image/jpeg" });
  if (up.error) return { error: up.error };
  const { data } = supabase.storage.from("log-photos").getPublicUrl(path);
  return { url: (data && data.publicUrl) || null };
}

// Delete this user's whole log for a match — the match_log AND its player ratings (nothing orphaned).
export async function deleteMatchLog(matchId) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const mid = String(matchId);
  await supabase.from("ratings").delete().eq("user_id", uid).eq("match_id", mid).eq("target_type", "player");
  const { error } = await supabase.from("match_logs").delete().eq("user_id", uid).eq("match_id", mid);
  return { error: error || null };
}

// Everyone's match logs for one match (public read), newest first, with usernames — the Ratings tab.
export async function fetchMatchLogs(matchId) {
  const { data } = await supabase.from("match_logs").select("user_id, rating, tags, attended, venue, photo, created_at")
    .eq("match_id", String(matchId)).order("created_at", { ascending: false }).limit(120);
  const rows = data || [];
  if (!rows.length) return [];
  const ids = Array.from(new Set(rows.map(function (r) { return r.user_id; })));
  const { data: profs } = await supabase.from("profiles").select("id, username").in("id", ids);
  const nameById = {};
  (profs || []).forEach(function (p) { nameById[p.id] = p.username; });
  return rows.map(function (r) {
    return { userId: r.user_id, user: nameById[r.user_id] || "kullanıcı", rating: Number(r.rating), tags: r.tags || [],
      attended: !!r.attended, venue: r.venue || null, photo: r.photo || null, created_at: r.created_at };
  });
}

// How many people logged (rated) each match, in ONE query — the finished-match list badge.
export async function fetchLogCounts(matchIds) {
  const ids = Array.from(new Set((matchIds || []).map(String).filter(Boolean)));
  if (!ids.length) return {};
  const { data } = await supabase.from("match_logs").select("match_id").in("match_id", ids);
  const counts = {};
  (data || []).forEach(function (r) { const k = String(r.match_id); counts[k] = (counts[k] || 0) + 1; });
  return counts;
}

// A specific user's player ratings for one match (for the rating-detail sheet).
export async function fetchUserMatchRatings(matchId, userId) {
  const { data } = await supabase.from("ratings").select("target_id, target_name, rating")
    .eq("match_id", String(matchId)).eq("user_id", userId).eq("target_type", "player");
  return (data || []).map(function (r) { return { id: r.target_id, name: r.target_name, rating: Number(r.rating) }; });
}
