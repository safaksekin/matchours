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
    return { id: r.id, text: r.body, created_at: r.created_at, user: nameById[r.user_id] || "kullanıcı" };
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
    return { id: r.id, text: r.body, created_at: r.created_at, user: nameById[r.user_id] || "kullanıcı" };
  });
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
