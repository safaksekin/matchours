// app/lib/db.js — thin data-access helpers over Supabase for ratings & comments.
// RLS enforces "read all, write only your own", so these just shape the payloads.
import { supabase } from "./supabaseClient";

export async function getUserId() {
  try {
    const { data } = await supabase.auth.getUser();
    return data && data.user ? data.user.id : null;
  } catch (e) { return null; }
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

export async function addComment(opts) {
  const uid = await getUserId();
  if (!uid) return { error: "not_logged_in" };
  const { data, error } = await supabase.from("comments").insert({
    user_id: uid,
    target_type: opts.targetType,
    target_id: String(opts.targetId),
    match_id: opts.matchId != null ? String(opts.matchId) : null,
    target_name: opts.targetName || null,
    sport: opts.sport || "football",
    body: opts.body,
  }).select("id, body, created_at, user_id").single();
  return { data: data || null, error: error || null };
}
