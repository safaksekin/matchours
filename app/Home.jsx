"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { slugify } from "./_lib/routes";
import { supabase } from "./lib/supabaseClient";
import { fetchMyRating, saveRating, fetchComments, fetchMatchComments, addComment as dbAddComment, fetchCommunityFeed,
  fetchCommentCounts, fetchFavorites, addFavorite, removeFavorite, fetchMyComments, fetchMyUsername, updateUsername,
  savePrediction, fetchMyPrediction, fetchMyPredictionsFor, fetchPredictionCounts, fetchMyPredictions, fetchPredLeaderboard,
  createPredLeague, joinPredLeague, fetchMyPredLeagues, getUserId, deletePrediction,
  fetchRatingConsensus, fetchMyMatchRatings, fetchUserRatingProfile,
  saveMatchLog, fetchMyMatchLog, fetchMyLogs, fetchMatchLogs, fetchUserMatchRatings, fetchLogCounts, deleteMatchLog,
  fetchUserLogs, fetchUserComments, uploadLogPhoto, fetchMyRatedPlayers, backfillLogLogos,
  fetchMyAvatar, fetchUserAvatar, uploadAvatar } from "./lib/db";

// ── Favorites: a tiny module-level store so the save button works everywhere
// (search rows, player sheet, detail modals, favorites page) without prop-drilling. ──
var FAV = { map: {}, loaded: false, listeners: new Set(), loggedIn: false, onNeedLogin: null };
function favKey(kind, id) { return kind + ":" + String(id); }
function favHas(kind, id) { return !!FAV.map[favKey(kind, id)]; }
function favEmit() { FAV.listeners.forEach(function (fn) { fn(); }); }
function favLoad() {
  try { predReset(); } catch (e) {} // login/logout changed -> reload the user's feed predictions too
  fetchFavorites().then(function (rows) {
    var m = {}; (rows || []).forEach(function (r) { m[favKey(r.kind, r.ref_id)] = r; });
    FAV.map = m; FAV.loaded = true; favEmit();
  }).catch(function () {});
}
function favToggle(kind, id, name, image, meta) {
  if (!FAV.loggedIn) { if (FAV.onNeedLogin) FAV.onNeedLogin(); return; }
  var k = favKey(kind, id);
  var next = Object.assign({}, FAV.map);
  if (next[k]) { delete next[k]; FAV.map = next; favEmit(); removeFavorite(kind, id); }
  else {
    next[k] = { kind: kind, ref_id: String(id), name: name || null, image: image || null, meta: meta || null };
    FAV.map = next; favEmit(); addFavorite(next[k]);
  }
}
// subscribe a component to favorite changes
function useFavorites() {
  var [, force] = useState(0);
  useEffect(function () {
    var fn = function () { force(function (x) { return x + 1; }); };
    FAV.listeners.add(fn); return function () { FAV.listeners.delete(fn); };
  }, []);
  return FAV;
}

// Instagram-style save button (bookmark, no text); fills with accent purple when saved.
function FavButton({ kind, refId, name, image, meta, size }) {
  useFavorites();
  var on = favHas(kind, refId);
  var s = size || 32;
  return <button onClick={function (e) { e.stopPropagation(); favToggle(kind, refId, name, image, meta); }}
    aria-label="favori" style={{ width: s, height: s, borderRadius: 9, border: "none", background: "transparent",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      color: on ? COLORS.accent : COLORS.textMuted, WebkitTapHighlightColor: "transparent" }}>
    <svg width={Math.round(s * 0.56)} height={Math.round(s * 0.56)} viewBox="0 0 24 24"
      fill={on ? COLORS.accent : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  </button>;
}

// Per-match comment counts: a tiny batched store so every match card shows its real count
// with a single query per render batch (not one query per card). Requests within 60ms coalesce.
var CMT = { cache: {}, pending: new Set(), listeners: new Set(), timer: null };
function cmtEmit() { CMT.listeners.forEach(function (fn) { fn(); }); }
function cmtFlush() {
  CMT.timer = null;
  var ids = Array.from(CMT.pending); CMT.pending.clear();
  if (!ids.length) return;
  ids.forEach(function (id) { if (CMT.cache[id] == null) CMT.cache[id] = -1; }); // mark in-flight
  fetchCommentCounts(ids).then(function (map) {
    ids.forEach(function (id) { CMT.cache[id] = (map && map[id]) || 0; });
    cmtEmit();
  }).catch(function () { ids.forEach(function (id) { CMT.cache[id] = 0; }); cmtEmit(); });
}
function cmtRequest(id) {
  if (id == null) return;
  var k = String(id);
  if (CMT.cache[k] != null) return; // already have it or in-flight
  CMT.pending.add(k);
  if (!CMT.timer) CMT.timer = setTimeout(cmtFlush, 60);
}
// Keep a count fresh after the user posts a comment (so the card updates without a refetch).
function cmtBump(id, delta) {
  if (id == null) return;
  var k = String(id); var cur = CMT.cache[k]; if (cur == null || cur < 0) cur = 0;
  CMT.cache[k] = Math.max(0, cur + (delta == null ? 1 : delta)); cmtEmit();
}
function useCommentCount(id) {
  var [, force] = useState(0);
  useEffect(function () {
    var fn = function () { force(function (x) { return x + 1; }); };
    CMT.listeners.add(fn); cmtRequest(id);
    return function () { CMT.listeners.delete(fn); };
  }, [id]);
  var v = CMT.cache[String(id)];
  return (v == null || v < 0) ? 0 : v;
}

// Per-match prediction store: batch-loads the signed-in user's coupons for visible cards so the
// quick 1X2 on the feed reflects (and updates) their pick without a query per card.
var PRED = { cache: {}, pending: new Set(), listeners: new Set(), timer: null };
function predEmit() { PRED.listeners.forEach(function (fn) { fn(); }); }
function predReset() { PRED.cache = {}; predEmit(); } // called on login change (see favLoad)
function predFlush() {
  PRED.timer = null;
  var ids = Array.from(PRED.pending); PRED.pending.clear();
  if (!ids.length) return;
  if (!FAV.loggedIn) { ids.forEach(function (id) { PRED.cache[id] = null; }); predEmit(); return; }
  fetchMyPredictionsFor(ids).then(function (map) {
    ids.forEach(function (id) { PRED.cache[id] = (map && map[id]) || null; });
    predEmit();
  }).catch(function () { ids.forEach(function (id) { PRED.cache[id] = null; }); predEmit(); });
}
function predRequest(id) {
  if (id == null) return;
  var k = String(id);
  if (k in PRED.cache) return; // have it or in-flight
  PRED.cache[k] = undefined; PRED.pending.add(k);
  if (!PRED.timer) PRED.timer = setTimeout(predFlush, 60);
}
function predInvalidate(id) { if (id != null) { delete PRED.cache[String(id)]; } }
// One-tap 1X2 from a card: merge into any existing coupon (keeps MOTM/ratings) and save.
function predSet(match, onextwo) {
  if (!FAV.loggedIn) { if (FAV.onNeedLogin) FAV.onNeedLogin(); return; }
  var k = String(match.id);
  var row = PRED.cache[k] || {};
  var picks = Object.assign({}, row.picks || {}, { onextwo: onextwo });
  // toggled fully off (no 1X2, no MOTM, no ratings) -> delete the coupon so no empty row lingers
  if (!picks.onextwo && !picks.motm && !(picks.ratings && picks.ratings.length)) {
    PRED.cache[k] = null; predEmit();
    deletePrediction(match.id);
    return;
  }
  PRED.cache[k] = Object.assign({}, row, { picks: picks }); predEmit(); // optimistic
  savePrediction({
    matchId: match.id,
    matchTs: match.ts ? new Date(match.ts).toISOString() : null,
    leagueId: match.leagueId, picks: picks, meta: matchSnap(match),
  }).then(function (res) { if (res && res.data) { PRED.cache[k] = res.data; predEmit(); } });
}
function usePredPick(id) {
  var [, force] = useState(0);
  useEffect(function () {
    var fn = function () { force(function (x) { return x + 1; }); };
    PRED.listeners.add(fn); predRequest(id);
    return function () { PRED.listeners.delete(fn); };
  }, [id]);
  var row = PRED.cache[String(id)];
  return (row && row.picks) ? row.picks.onextwo : null;
}

// Batched "how many people predicted this match" counts (match-list badge), same pattern as comments.
var PCNT = { cache: {}, pending: new Set(), listeners: new Set(), timer: null };
function pcntEmit() { PCNT.listeners.forEach(function (fn) { fn(); }); }
function pcntFlush() {
  PCNT.timer = null;
  var ids = Array.from(PCNT.pending); PCNT.pending.clear();
  if (!ids.length) return;
  fetchPredictionCounts(ids).then(function (map) {
    ids.forEach(function (id) { PCNT.cache[id] = (map && map[id]) || 0; }); pcntEmit();
  }).catch(function () { ids.forEach(function (id) { PCNT.cache[id] = 0; }); pcntEmit(); });
}
function pcntRequest(id) {
  if (id == null) return; var k = String(id);
  if (k in PCNT.cache) return; PCNT.cache[k] = undefined; PCNT.pending.add(k);
  if (!PCNT.timer) PCNT.timer = setTimeout(pcntFlush, 60);
}
function usePredictionCount(id) {
  var [, force] = useState(0);
  useEffect(function () {
    var fn = function () { force(function (x) { return x + 1; }); };
    PCNT.listeners.add(fn); pcntRequest(id);
    return function () { PCNT.listeners.delete(fn); };
  }, [id]);
  var v = PCNT.cache[String(id)];
  return (v == null) ? 0 : v;
}

// Match-list badge: how many people predicted this match (with a "users" icon).
function PredCount({ match }) {
  var c = usePredictionCount(match && match.id);
  if (!match || match.homeId == null) return null; // football matches only
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.textMuted, fontSize: 12, fontWeight: 700, flexShrink: 0, paddingLeft: 2 }}>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
    {c}
  </span>;
}

// Batched "how many people rated (logged) this match" counts — same pattern as predictions.
var LCNT = { cache: {}, pending: new Set(), listeners: new Set(), timer: null };
function lcntEmit() { LCNT.listeners.forEach(function (fn) { fn(); }); }
function lcntFlush() {
  LCNT.timer = null;
  var ids = Array.from(LCNT.pending); LCNT.pending.clear();
  if (!ids.length) return;
  fetchLogCounts(ids).then(function (map) {
    ids.forEach(function (id) { LCNT.cache[id] = (map && map[id]) || 0; }); lcntEmit();
  }).catch(function () { ids.forEach(function (id) { LCNT.cache[id] = 0; }); lcntEmit(); });
}
function lcntRequest(id) {
  if (id == null) return; var k = String(id);
  if (k in LCNT.cache) return; LCNT.cache[k] = undefined; LCNT.pending.add(k);
  if (!LCNT.timer) LCNT.timer = setTimeout(lcntFlush, 60);
}
function useLogCount(id) {
  var [, force] = useState(0);
  useEffect(function () {
    var fn = function () { force(function (x) { return x + 1; }); };
    LCNT.listeners.add(fn); lcntRequest(id);
    return function () { LCNT.listeners.delete(fn); };
  }, [id]);
  var v = LCNT.cache[String(id)];
  return (v == null) ? 0 : v;
}
// Finished-match list badge: how many people rated this match (star icon), replaces the prediction count.
function RatingCount({ match }) {
  var c = useLogCount(match && match.id);
  if (!match || match.homeId == null) return null; // football matches only
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.textMuted, fontSize: 12, fontWeight: 700, flexShrink: 0, paddingLeft: 2 }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.27l-5.9 3.09 1.13-6.58L2.45 9.14l6.6-.96z" /></svg>
    {c}
  </span>;
}

// Quick 1X2 predict widget on a feed card — the retention hook: predict without opening the match.
function Quick1x2({ match, layout }) {
  var fav = useFavorites(); // re-render on login
  var pick = usePredPick(match.id);
  if (!match || match.status !== "upcoming" || match.homeId == null) return null;
  var vertical = layout === "below"; // carousel: full-width row; card: compact cluster on the right
  function btn(v) {
    var on = pick === v;
    return <button key={v} onClick={function (e) { e.stopPropagation(); predSet(match, on ? null : v); }}
      style={{ flex: vertical ? 1 : "0 0 auto", minWidth: vertical ? 0 : 30, padding: vertical ? "9px 0" : "5px 0", width: vertical ? "auto" : 30,
        borderRadius: vertical ? 12 : 8, cursor: "pointer", fontFamily: FONT, fontSize: vertical ? 14 : 12, fontWeight: 800,
        border: "1px solid " + (on ? "transparent" : COLORS.border), background: on ? COLORS.accent : (vertical ? COLORS.card : "transparent"),
        color: on ? "#fff" : COLORS.textSecondary, WebkitTapHighlightColor: "transparent",
        transition: "background 0.2s ease" }}>{v}</button>;
  }
  return <div onClick={function (e) { e.stopPropagation(); }}
    style={{ display: "flex", gap: vertical ? 8 : 4, flexShrink: 0, alignItems: "center" }}>
    {btn("1")}{btn("X")}{btn("2")}
  </div>;
}

// Per-device "seen" set for scored-coupon notifications (drives the bell's unread badge).
function notifSeen(id) { try { return (localStorage.getItem("mo_notif_seen") || "").split(",").indexOf(String(id)) >= 0; } catch (e) { return false; } }
function notifMarkSeen(ids) {
  try {
    var arr = (localStorage.getItem("mo_notif_seen") || "").split(",").filter(Boolean);
    ids.forEach(function (id) { if (arr.indexOf(String(id)) < 0) arr.push(String(id)); });
    localStorage.setItem("mo_notif_seen", arr.slice(-400).join(","));
  } catch (e) {}
}

// Branded splash: our logo on the navbar-purple. Static while loading; fades out once the app mounts.
// Shown ONCE per session (SPLASH_DONE) so switching bottom-nav tabs doesn't re-trigger it.
var SPLASH_DONE = false;
function Splash({ fade }) {
  var [gone, setGone] = useState(fade && SPLASH_DONE);
  var [faded, setFaded] = useState(false);
  useEffect(function () {
    if (!fade || SPLASH_DONE) return;
    var r = requestAnimationFrame(function () { setFaded(true); });
    var id = setTimeout(function () { setGone(true); SPLASH_DONE = true; }, 650);
    return function () { cancelAnimationFrame(r); clearTimeout(id); };
  }, [fade]);
  if (fade && (gone || SPLASH_DONE)) return null;
  return <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 9999,
    background: "linear-gradient(135deg, #7A52E6 0%, #5A33CC 52%, #4322A0 100%)",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: (fade && faded) ? 0 : 1, transition: "opacity 0.55s ease", pointerEvents: (fade && faded) ? "none" : "auto" }}>
    <img src="/logo-light.png" alt="fikstür" style={{ height: 92, maxWidth: "76%", objectFit: "contain" }} />
  </div>;
}

// Notifications bell (header): shows your scored coupons + points earned. In-app for now;
// real push (browser/OS) is a later phase (needs a service worker + web-push).
function NotificationsBell({ loggedIn, onOpenMatch, matches, t }) {
  useFavorites(); // re-render when favorites change
  var [coupons, setCoupons] = useState([]);
  var [open, setOpen] = useState(false);
  var [, force] = useState(0);
  var btnRef = useRef(null);
  var [pos, setPos] = useState({ top: 58, right: 12 });
  useEffect(function () {
    if (!loggedIn) { setCoupons([]); return; }
    var cancelled = false;
    fetch("/api/predict/score").catch(function () {}).finally(function () {
      fetchMyPredictions(40).then(function (r) { if (!cancelled) setCoupons((r.items || []).filter(function (x) { return x.scored; })); }).catch(function () {});
    });
    return function () { cancelled = true; };
  }, [loggedIn]);
  if (!loggedIn) return null;
  // merge: your scored coupons + finished results of your favourite teams (no duplicate per match)
  var couponMatchIds = {};
  var couponNotifs = coupons.map(function (x) { var m = x.meta || {}; couponMatchIds[String(x.match_id)] = 1; return { id: "cp:" + x.id, kind: "coupon", home: m.home, away: m.away, points: x.points || 0, openM: m.id ? m : { id: x.match_id }, ts: m.ts || 0 }; });
  var resultNotifs = (matches || []).filter(function (m) {
    return m.status === "finished" && m.homeId != null && !couponMatchIds[String(m.id)] && (favHas("team", m.homeId) || favHas("team", m.awayId));
  }).map(function (m) { return { id: "rs:" + m.id, kind: "result", home: m.home, away: m.away, score: m.score, openM: m, ts: m.ts || 0 }; });
  var notifs = couponNotifs.concat(resultNotifs).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 30);
  var unread = notifs.filter(function (x) { return !notifSeen(x.id); }).length;
  function toggle() {
    var willOpen = !open;
    if (willOpen && btnRef.current) {
      var r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(willOpen);
    if (willOpen && notifs.length) { notifMarkSeen(notifs.map(function (x) { return x.id; })); force(function (n) { return n + 1; }); }
  }
  // dropdown is portalled to <body> so it escapes the light-mode navbar's white-text (.mo-navlight) styles
  var dropdown = <>
    <div onClick={function () { setOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 1200 }} />
    <div style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 1201, width: "min(340px, 92vw)", background: COLORS.card, fontFamily: FONT,
      border: "1px solid " + COLORS.border, borderRadius: 14, boxShadow: "0 12px 36px rgba(20,40,40,0.30)", overflow: "hidden", maxHeight: "75vh", overflowY: "auto" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid " + COLORS.border, color: COLORS.textPrimary, fontSize: 14, fontWeight: 800 }}>Bildirimler</div>
        {notifs.length === 0
          ? <EmptyState icon={<EmptyIcon name="bell" />} title="Bildirim yok" hint="Kuponların puanlanınca ve favori takımların oynayınca burada görünür." />
          : notifs.map(function (x) {
            var isCoupon = x.kind === "coupon";
            var mn = (x.home && x.away) ? (locTeam(x.home, t) + " - " + locTeam(x.away, t)) : "Maç";
            return <div key={x.id} onClick={function () { setOpen(false); if (onOpenMatch) onOpenMatch(x.openM); }}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderBottom: "1px solid " + COLORS.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: COLORS.accentDim, color: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {isCoupon
                  ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
                  : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m12 7 2.9 2.1-1.1 3.4h-3.6L9.1 9.1z" /></svg>}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mn}</div>
                <div style={{ color: COLORS.textSecondary, fontSize: 11.5, marginTop: 1 }}>
                  {isCoupon
                    ? <span>maçındaki tahminlerinden <b style={{ color: COLORS.accent }}>+{x.points} puan</b> kazandın</span>
                    : <span>maçı sonuçlandı{x.score ? " · " + x.score : ""}</span>}
                </div>
              </div>
            </div>; })}
    </div>
  </>;
  return <div style={{ position: "relative" }}>
    <button ref={btnRef} onClick={toggle} aria-label="bildirimler" style={{ width: 38, height: 38, borderRadius: 12, background: COLORS.cardAlt, border: "none",
      cursor: "pointer", color: COLORS.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", WebkitTapHighlightColor: "transparent" }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
      {unread > 0 && <span style={{ position: "absolute", top: 5, right: 5, minWidth: 15, height: 15, borderRadius: 8, background: COLORS.red, color: "#fff",
        fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && typeof document !== "undefined" && createPortal(dropdown, document.body)}
  </div>;
}

// Track (per device) which matches THIS user generated an AI preview for, so it auto-shows
// for them on reopen — but other users still see the "generate" button (which serves the cache).
function aiSeen(id) { try { return (localStorage.getItem("mo_ai_seen") || "").split(",").indexOf(String(id)) >= 0; } catch (e) { return false; } }
function aiMarkSeen(id) {
  try {
    var arr = (localStorage.getItem("mo_ai_seen") || "").split(",").filter(Boolean);
    if (arr.indexOf(String(id)) < 0) { arr.push(String(id)); localStorage.setItem("mo_ai_seen", arr.slice(-300).join(",")); }
  } catch (e) {}
}

// Minimal match snapshot stored with a comment so the feed can render a quote card AND re-open the match.
function matchSnap(m) {
  if (!m) return null;
  return { id: m.id, home: m.home, away: m.away, homeLogo: m.homeLogo, awayLogo: m.awayLogo,
    homeId: m.homeId, awayId: m.awayId, score: m.score, penScore: m.penScore, status: m.status, minute: m.minute,
    time: m.time, date: m.date, league: m.league, leagueId: m.leagueId, season: m.season, stats: {} };
}

// "2025/26" style season label from a starting year.
function fmtSeasonLabel(yr) {
  if (yr == null) return "";
  var nx = String((yr + 1) % 100); if (nx.length < 2) nx = "0" + nx;
  return yr + "/" + nx;
}

// Twitter-style relative time, localized: now / Xs / Xm / Xh, then the date past 1 day.
function relTime(iso, lang) {
  var L = lang || "tr";
  var W = {
    tr: { now: "şimdi", s: "sn önce", m: "dk önce", h: "sa önce", loc: "tr-TR" },
    en: { now: "now", s: "s ago", m: "m ago", h: "h ago", loc: "en-US" },
    de: { now: "jetzt", s: "s", m: "m", h: "Std", loc: "de-DE" },
  }[L] || { now: "şimdi", s: "sn önce", m: "dk önce", h: "sa önce", loc: "tr-TR" };
  function unit(n, key) { return L === "de" ? ("vor " + n + W[key]) : (n + W[key]); }
  try {
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 5) return W.now;
    if (diff < 60) return unit(Math.floor(diff), "s");
    if (diff < 3600) return unit(Math.floor(diff / 60), "m");
    if (diff < 86400) return unit(Math.floor(diff / 3600), "h");
    return new Date(iso).toLocaleDateString(W.loc, { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (e) { return ""; }
}

// short Turkish timestamp for stored comments ("27.06 21:40")
function fmtCommentTime(iso) {
  try { return new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return ""; }
}

// Colors resolve to CSS variables so a single [data-theme] flip re-skins everything.
const COLORS = {
  bg: "var(--bg)", surface: "var(--card)", card: "var(--card)", cardAlt: "var(--cardAlt)",
  border: "var(--border)", accent: "var(--accent)", accentDim: "var(--accentDim)",
  accentGrad: "var(--accentGrad)", accentGlow: "var(--accentGlow)",
  glassPurple: "var(--glassPurple)", glassBorder: "var(--glassBorder)",
  teal: "var(--teal)", mint: "var(--mint)",
  purple: "var(--purple)", purpleDim: "var(--purpleDim)",
  textPrimary: "var(--textPrimary)", textSecondary: "var(--textSecondary)", textMuted: "var(--textMuted)",
  red: "var(--red)", yellow: "var(--yellow)",
};

const THEME_VARS = {
  light: {
    "--bg": "#F1F2F6", "--card": "#FFFFFF", "--cardAlt": "#E9EBF1",
    "--border": "#D7DBE8", "--accent": "#5A33CC", "--accentDim": "rgba(90,51,204,0.10)",
    "--accentGrad": "linear-gradient(135deg, #7A52E6 0%, #5A33CC 52%, #4322A0 100%)",
    "--accentGlow": "0 6px 18px -7px rgba(90,51,204,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
    "--glassPurple": "linear-gradient(140deg, rgba(122,82,230,0.18), rgba(90,51,204,0.07) 55%, rgba(67,34,160,0.13))",
    "--glassBorder": "rgba(122,82,230,0.30)",
    "--teal": "#C9CDDA", "--mint": "#EDEFF3",
    "--purple": "#2FAE55", "--purpleDim": "rgba(47,174,85,0.16)",
    "--textPrimary": "#161A35", "--textSecondary": "#585E82", "--textMuted": "#9AA0C0",
    "--red": "#FF0000", "--yellow": "#F8DE22",
    "--modalGrad": "linear-gradient(180deg, rgba(255,255,255,0.70), rgba(242,243,252,0.80))",
    "--modalBorder": "rgba(255,255,255,0.6)",
  },
  dark: {
    "--bg": "#0A0A0C", "--card": "#1B1B1F", "--cardAlt": "#26262B",
    "--border": "#34343A", "--accent": "#6A45E6", "--accentDim": "rgba(106,69,230,0.18)",
    "--accentGrad": "linear-gradient(135deg, #8B6CFF 0%, #6A45E6 48%, #4D2FB0 100%)",
    "--accentGlow": "0 6px 20px -6px rgba(106,69,230,0.55), inset 0 1px 0 rgba(255,255,255,0.28)",
    "--glassPurple": "linear-gradient(140deg, rgba(139,108,255,0.24), rgba(106,69,230,0.10) 55%, rgba(77,47,176,0.18))",
    "--glassBorder": "rgba(160,130,255,0.32)",
    "--teal": "#26262B", "--mint": "#161618",
    "--purple": "#3FD176", "--purpleDim": "rgba(63,209,118,0.18)",
    "--textPrimary": "#E8EAFB", "--textSecondary": "#A8AECE", "--textMuted": "#767C9E",
    "--red": "#FF0000", "--yellow": "#F8DE22",
    "--modalGrad": "linear-gradient(180deg, rgba(30,30,34,0.80), rgba(14,14,16,0.88))",
    "--modalBorder": "rgba(255,255,255,0.08)",
  },
};

var CURRENT_THEME = "dark"; // tracked so logo helpers can pick dark-friendly (white) league logos
function applyTheme(theme) {
  CURRENT_THEME = theme;
  if (typeof document === "undefined") return;
  var vars = THEME_VARS[theme] || THEME_VARS.light;
  var root = document.documentElement;
  Object.keys(vars).forEach(function(k){ root.style.setProperty(k, vars[k]); });
  root.style.colorScheme = theme;
}
const FONT = "var(--font-app), 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Local YYYY-MM-DD (avoids the UTC day-shift of toISOString near midnight).
function isoLocal(d) {
  var m = ("0" + (d.getMonth() + 1)).slice(-2);
  var day = ("0" + d.getDate()).slice(-2);
  return d.getFullYear() + "-" + m + "-" + day;
}

const I18N = {
  tr: { _lang: "tr", tagline: "Tüm spor istatistikleri, tek ekranda.", email: "E-posta", password: "Şifre",
    login: "Giriş Yap", signInBtn: "Oturum Aç", menu: "Menü", loggingIn: "Giriş yapılıyor...", noAccount: "Hesabın yok mu?", signup: "Kayıt ol",
    matches: "Maç", noMatches: "Bu kategoride maç bulunamadı.", noLiveMatches: "Şu an oynanan canlı maç yok.", loading: "Yükleniyor...", totwTitle: "Haftanın 11'i",
    live: "CANLI", info: "Bilgi", grid: "Grid", tv: "Yayın", comments: "Yorumlar", commentDo: "Yorum yap",
    referee: "Hakem", stadium: "Stadyum", city: "Şehir", rank: "Lig Sırası",
    last5: "Son 5 Maç", draw: "Berabere", totalMatches: "karşılaşma", h2hLoad: "H2H yükle",
    writeComment: "Yorum yaz...", send: "Gönder", now: "şimdi",
    profile: "Profil", back: "Geri", member: "matchours üyesi", pro: "PRO üye",
    followedMatches: "Takip Edilen", commentsCount: "Yorum", favLeague: "Favori Lig", membership: "Üyelik",
    favTeams: "Favori Takımlar", recentActivity: "Son Aktivite", logout: "Çıkış Yap",
    navMatch: "Maç", navSearch: "Ara", navCommunity: "Topluluk", navFavorites: "Favoriler", navProfile: "Profil", navPredictions: "Tahminler",
    community: "Topluluk", favorites: "Favoriler", favPlayers: "Favori Oyuncular", recentComments: "Son Yorumların",
    noFavorites: "Henüz favori yok. Takım veya oyuncuların yanındaki kaydet butonuna dokun.",
    favLoginPrompt: "Favorilerini görmek için giriş yap.", noComments: "Henüz yorum yok. İlk yorumu sen yap!",
    matchTag: "Maç", playerTag: "Oyuncu", teamTag: "Takım", popularLeagues: "Popüler Ligler",
    username: "Kullanıcı adı", usernameHint: "Kullanıcı adı en az 2 karakter olmalı.", save: "Kaydet",
    scorers: "Gol Kralları", standing: "Puan Durumu", points: "P", matchday: "Hafta", week: "Hafta", noStandings: "Puan durumu mevcut değil.", noH2h: "Geçmiş karşılaşma yok.",
    fillFields: "Email ve şifre gerekli.", checkEmail: "Onay için e-postanı kontrol et.",
    finished: "Maç Sonucu",
    vsHome: "vs", vsAway: "@",
    squads: "Kadrolar", matchStats: "İstatistik", bench: "Yedekler", lineupSoon: "Kadro henüz açıklanmadı.", noMatchStats: "İstatistik mevcut değil.", possession: "Topla Oynama", shots: "Şut", shotsOn: "İsabetli Şut", shotsOff: "İsabetsiz Şut", corners: "Korner", fouls: "Faul", offsides: "Ofsayt", saves: "Kurtarış", throwIns: "Taç", freeKicks: "Serbest Vuruş", goalKicks: "Kale Vuruşu", yellowCards: "Sarı Kart", redCards: "Kırmızı Kart",
    blockedShots: "Bloke Şut", totalPasses: "Toplam Pas", accuratePasses: "İsabetli Pas",
    substitutions: "Değişiklikler",
    h2hLabel: "Rekabet Geçmişi", pastMatches: "Geçmiş Maçlar", vsLabel: "vs", finishedTab: "Biten Maçlar", upcomingTab: "Oynanacak Maçlar", liveTab: "Canlı",
    searchPlaceholder: "Takım, lig veya oyuncu ara...", noResults: "Sonuç bulunamadı.",
    players: "Oyuncular", noPlayerFound: "Oyuncu bulunamadı.", plProfile: "Oyuncu Profili", teamsLabel: "Takımlar", matchesLabel: "Maçlar",
    tmProfile: "Takım Profili", founded: "Kuruluş", capacity: "Kapasite", formLabel: "Form", gFor: "Attığı", gAgainst: "Yediği",
    pmTitle: "Maç İstatistikleri", pmDribbles: "Çalım", pmPassAcc: "Pas İsabeti", pmNoData: "Bu oyuncu için istatistik yok.",
    leaguesTitle: "Ligler", fixturesLabel: "Fikstür", yourRating: "Senin Puanın", perfComment: "Performans Yorumu", rateSubmit: "Oyla", rateSaved: "Puanın kaydedildi", todayLabel: "Bugün", standoutsTitle: "Günün Göze Çarpanları", allLabel: "Tümü",
    plApps: "Maç", plGoals: "Gol", plAssists: "Asist", plMinutes: "Dakika", plRating: "Puan",
    plTrophies: "Kupalar", plCompetitions: "Turnuvalar", plPosition: "Pozisyon", plNationality: "Uyruk",
    plAge: "Yaş", plSeason: "Sezon", plWinner: "Şampiyon", weather: "Hava Durumu", wxClear: "Açık", wxCloudy: "Bulutlu", wxFog: "Sisli", wxRain: "Yağmurlu", wxSnow: "Karlı", wxShowers: "Sağanak", wxStorm: "Fırtına",
    team: "Takım", played: "O", gd: "AV",
    summary: "Özet", noEvents: "Olay bulunamadı.", penalty: "Penaltı", ownGoal: "Kendi kalesine", injuries: "Sakat / Cezalı", injured: "Sakat", suspended: "Cezalı", seasonAvgNote: "Sezon ortalamaları", matchesPlayed: "Oynanan", gfAvg: "Gol Ort.", gaAvg: "Yenilen Ort.", cleanSheets: "Gol Yemeden", wins: "Galibiyet", loses: "Mağlubiyet",
    viewDetails: "Detaylar",
    settings: "Ayarlar", news: "Haberler", language: "Dil", moreSoon: "Daha fazla ayar yakında.", newsSoon: "Haberler yakında eklenecek.", topScorers: "Gol Kralları", topAssists: "Asist Kralları",
    appearance: "Görünüm", darkMode: "Koyu Mod",
    sports: { live: "Canlı", football: "Futbol", basketball: "Basketbol", motorsport: "Formula 1", tennis: "Tenis", volleyball: "Voleybol", esports: "Espor", mma: "MMA" } },
  en: { _lang: "en", tagline: "All sports stats, on one screen.", email: "Email", password: "Password",
    login: "Log In", signInBtn: "Sign In", menu: "Menu", loggingIn: "Logging in...", noAccount: "No account?", signup: "Sign up",
    matches: "Matches", noMatches: "No matches in this category.", noLiveMatches: "No live matches right now.", loading: "Loading...", totwTitle: "Team of the Round",
    live: "LIVE", info: "Info", grid: "Grid", tv: "Broadcast", comments: "Comments", commentDo: "Comment",
    referee: "Referee", stadium: "Stadium", city: "City", rank: "League Rank",
    last5: "Last 5 Matches", draw: "Draw", totalMatches: "meetings", h2hLoad: "Load H2H",
    writeComment: "Write a comment...", send: "Send", now: "now",
    profile: "Profile", back: "Back", member: "matchours member", pro: "PRO member",
    followedMatches: "Followed", commentsCount: "Comments", favLeague: "Favorite League", membership: "Member Since",
    favTeams: "Favorite Teams", recentActivity: "Recent Activity", logout: "Log Out",
    navMatch: "Matches", navSearch: "Search", navCommunity: "Community", navFavorites: "Favorites", navProfile: "Profile", navPredictions: "Predictions",
    community: "Community", favorites: "Favorites", favPlayers: "Favorite Players", recentComments: "Your Recent Comments",
    noFavorites: "No favorites yet. Tap the save button next to a team or player.",
    favLoginPrompt: "Sign in to see your favorites.", noComments: "No comments yet. Be the first!",
    matchTag: "Match", playerTag: "Player", teamTag: "Team", popularLeagues: "Popular Leagues",
    username: "Username", usernameHint: "Username must be at least 2 characters.", save: "Save",
    scorers: "Top Scorers", standing: "Standings", points: "pts", matchday: "Matchday", week: "Week", noStandings: "Standings not available.", noH2h: "No previous meetings.",
    fillFields: "Email and password required.", checkEmail: "Check your email to confirm.",
    finished: "Full Time",
    vsHome: "vs", vsAway: "@",
    squads: "Lineups", matchStats: "Stats", bench: "Bench", lineupSoon: "Lineup not announced yet.", noMatchStats: "Stats not available.", possession: "Possession", shots: "Shots", shotsOn: "Shots on", shotsOff: "Shots off", corners: "Corners", fouls: "Fouls", offsides: "Offsides", saves: "Saves", throwIns: "Throw-ins", freeKicks: "Free kicks", goalKicks: "Goal kicks", yellowCards: "Yellow cards", redCards: "Red cards",
    blockedShots: "Blocked", totalPasses: "Total Passes", accuratePasses: "Accurate Passes",
    substitutions: "Substitutions",
    h2hLabel: "H2H", pastMatches: "Past Matches", vsLabel: "vs", finishedTab: "Finished", upcomingTab: "Upcoming", liveTab: "Live",
    searchPlaceholder: "Search team, league or player...", noResults: "No results.",
    players: "Players", noPlayerFound: "No players found.", plProfile: "Player Profile", teamsLabel: "Teams", matchesLabel: "Matches",
    tmProfile: "Team Profile", founded: "Founded", capacity: "Capacity", formLabel: "Form", gFor: "Goals For", gAgainst: "Goals Against",
    pmTitle: "Match Stats", pmDribbles: "Dribbles", pmPassAcc: "Pass Accuracy", pmNoData: "No stats for this player.",
    leaguesTitle: "Leagues", fixturesLabel: "Fixtures", yourRating: "Your Rating", perfComment: "Performance Note", rateSubmit: "Rate", rateSaved: "Rating saved", todayLabel: "Today", standoutsTitle: "Standouts of the Day", allLabel: "All",
    plApps: "Apps", plGoals: "Goals", plAssists: "Assists", plMinutes: "Minutes", plRating: "Rating",
    plTrophies: "Trophies", plCompetitions: "Competitions", plPosition: "Position", plNationality: "Nationality",
    plAge: "Age", plSeason: "Season", plWinner: "Winner", weather: "Weather", wxClear: "Clear", wxCloudy: "Cloudy", wxFog: "Fog", wxRain: "Rain", wxSnow: "Snow", wxShowers: "Showers", wxStorm: "Storm",
    team: "Team", played: "P", gd: "GD",
    summary: "Summary", noEvents: "No events.", penalty: "Penalty", ownGoal: "Own goal", injuries: "Injuries / Suspended", injured: "Injured", suspended: "Suspended", seasonAvgNote: "Season averages", matchesPlayed: "Played", gfAvg: "Goals For Avg", gaAvg: "Goals Against Avg", cleanSheets: "Clean Sheets", wins: "Wins", loses: "Losses",
    viewDetails: "Details",
    settings: "Settings", news: "News", language: "Language", moreSoon: "More settings soon.", newsSoon: "News coming soon.", topScorers: "Top Scorers", topAssists: "Top Assists",
    appearance: "Appearance", darkMode: "Dark Mode",
    sports: { live: "Live", football: "Football", basketball: "Basketball", motorsport: "Formula 1", tennis: "Tennis", volleyball: "Volleyball", esports: "Esports", mma: "MMA" } },
  de: { _lang: "de", tagline: "Alle Sportstatistiken auf einem Bildschirm.", email: "E-Mail", password: "Passwort",
    login: "Anmelden", signInBtn: "Anmelden", menu: "Menü", loggingIn: "Anmeldung...", noAccount: "Kein Konto?", signup: "Registrieren",
    matches: "Spiele", noMatches: "Keine Spiele in dieser Kategorie.", noLiveMatches: "Derzeit keine Live-Spiele.", loading: "Laden...", totwTitle: "Team der Runde",
    live: "LIVE", info: "Info", grid: "Grid", tv: "Ubertragung", comments: "Kommentare", commentDo: "Kommentieren",
    referee: "Schiedsrichter", stadium: "Stadion", city: "Stadt", rank: "Tabellenplatz",
    last5: "Letzte 5 Spiele", draw: "Unentschieden", totalMatches: "Begegnungen", h2hLoad: "H2H laden",
    writeComment: "Kommentar schreiben...", send: "Senden", now: "jetzt",
    profile: "Profil", back: "Zuruck", member: "matchours Mitglied", pro: "PRO Mitglied",
    followedMatches: "Verfolgt", commentsCount: "Kommentare", favLeague: "Lieblingsliga", membership: "Mitglied seit",
    favTeams: "Lieblingsteams", recentActivity: "Letzte Aktivitat", logout: "Abmelden",
    navMatch: "Spiele", navSearch: "Suche", navCommunity: "Community", navFavorites: "Favoriten", navProfile: "Profil", navPredictions: "Tipps",
    community: "Community", favorites: "Favoriten", favPlayers: "Lieblingsspieler", recentComments: "Deine letzten Kommentare",
    noFavorites: "Noch keine Favoriten. Tippe auf das Speichern-Symbol neben einem Team oder Spieler.",
    favLoginPrompt: "Melde dich an, um deine Favoriten zu sehen.", noComments: "Noch keine Kommentare. Sei der Erste!",
    matchTag: "Spiel", playerTag: "Spieler", teamTag: "Team", popularLeagues: "Beliebte Ligen",
    username: "Benutzername", usernameHint: "Benutzername muss mind. 2 Zeichen haben.", save: "Speichern",
    scorers: "Torjager", standing: "Tabelle", points: "Pkt", matchday: "Spieltag", week: "Spieltag", noStandings: "Tabelle nicht verfugbar.", noH2h: "Keine fruheren Begegnungen.",
    fillFields: "E-Mail und Passwort erforderlich.", checkEmail: "Bestatige deine E-Mail.",
    finished: "Endstand",
    vsHome: "vs", vsAway: "@",
    squads: "Aufstellung", matchStats: "Statistik", bench: "Bank", lineupSoon: "Aufstellung noch nicht bekannt.", noMatchStats: "Statistik nicht verfugbar.", possession: "Ballbesitz", shots: "Schusse", shotsOn: "Aufs Tor", shotsOff: "Daneben", corners: "Ecken", fouls: "Fouls", offsides: "Abseits", saves: "Paraden", throwIns: "Einwurfe", freeKicks: "Freistosse", goalKicks: "Abstosse", yellowCards: "Gelbe Karten", redCards: "Rote Karten",
    blockedShots: "Geblockt", totalPasses: "Passe gesamt", accuratePasses: "Genaue Passe",
    substitutions: "Wechsel",
    h2hLabel: "Eins gegen Eins", pastMatches: "Fruhere Spiele", vsLabel: "vs", finishedTab: "Beendet", upcomingTab: "Anstehend", liveTab: "Live",
    searchPlaceholder: "Team, Liga oder Spieler suchen...", noResults: "Keine Ergebnisse.",
    players: "Spieler", noPlayerFound: "Keine Spieler gefunden.", plProfile: "Spielerprofil", teamsLabel: "Teams", matchesLabel: "Spiele",
    tmProfile: "Teamprofil", founded: "Gegrundet", capacity: "Kapazitat", formLabel: "Form", gFor: "Tore", gAgainst: "Gegentore",
    pmTitle: "Spielstatistik", pmDribbles: "Dribblings", pmPassAcc: "Passquote", pmNoData: "Keine Statistik fur diesen Spieler.",
    leaguesTitle: "Ligen", fixturesLabel: "Spielplan", yourRating: "Deine Note", perfComment: "Leistungsnotiz", rateSubmit: "Bewerten", rateSaved: "Bewertung gespeichert", todayLabel: "Heute", standoutsTitle: "Tagesstars", allLabel: "Alle",
    plApps: "Spiele", plGoals: "Tore", plAssists: "Vorlagen", plMinutes: "Minuten", plRating: "Note",
    plTrophies: "Trophaen", plCompetitions: "Wettbewerbe", plPosition: "Position", plNationality: "Nationalitat",
    plAge: "Alter", plSeason: "Saison", plWinner: "Sieger", weather: "Wetter", wxClear: "Klar", wxCloudy: "Bewolkt", wxFog: "Nebel", wxRain: "Regen", wxSnow: "Schnee", wxShowers: "Schauer", wxStorm: "Sturm",
    team: "Team", played: "Sp", gd: "TD",
    summary: "Zusammenfassung", noEvents: "Keine Ereignisse.", penalty: "Elfmeter", ownGoal: "Eigentor", injuries: "Verletzt / Gesperrt", injured: "Verletzt", suspended: "Gesperrt", seasonAvgNote: "Saisondurchschnitt", matchesPlayed: "Spiele", gfAvg: "Tore Schnitt", gaAvg: "Gegentore Schnitt", cleanSheets: "Zu Null", wins: "Siege", loses: "Niederlagen",
    viewDetails: "Details",
    settings: "Einstellungen", news: "Nachrichten", language: "Sprache", moreSoon: "Mehr bald.", newsSoon: "Nachrichten bald.", topScorers: "Torjager", topAssists: "Vorlagengeber",
    appearance: "Darstellung", darkMode: "Dunkler Modus",
    sports: { live: "Live", football: "Fussball", basketball: "Basketball", motorsport: "Formel 1", tennis: "Tennis", volleyball: "Volleyball", esports: "E-Sport", mma: "MMA" } },
};

const SPORT_TABS = [
  { id: "football",   icon: "/cat2.png" },
  { id: "basketball", icon: "/cat3.png" },
  { id: "motorsport", icon: "/cat4.png" },
  { id: "tennis",     icon: "/cat5.png" },
  { id: "volleyball", icon: "/cat6.png" },
  { id: "esports",    icon: "/cat7.png" },
  { id: "mma",        icon: "/cat8.png" },
];

// National team name localization (API returns English). Falls back to the API name.
const TEAM_NAMES = {
  "Germany": { tr: "Almanya", de: "Deutschland" },
  "Spain": { tr: "İspanya", de: "Spanien" },
  "France": { tr: "Fransa", de: "Frankreich" },
  "England": { tr: "İngiltere", de: "England" },
  "Italy": { tr: "İtalya", de: "Italien" },
  "Netherlands": { tr: "Hollanda", de: "Niederlande" },
  "Belgium": { tr: "Belçika", de: "Belgien" },
  "Portugal": { tr: "Portekiz", de: "Portugal" },
  "Croatia": { tr: "Hırvatistan", de: "Kroatien" },
  "Turkey": { tr: "Türkiye", de: "Türkei" },
  "Türkiye": { tr: "Türkiye", de: "Türkei" },
  "Switzerland": { tr: "İsviçre", de: "Schweiz" },
  "Austria": { tr: "Avusturya", de: "Österreich" },
  "Poland": { tr: "Polonya", de: "Polen" },
  "Denmark": { tr: "Danimarka", de: "Dänemark" },
  "Sweden": { tr: "İsveç", de: "Schweden" },
  "Norway": { tr: "Norveç", de: "Norwegen" },
  "Scotland": { tr: "İskoçya", de: "Schottland" },
  "Wales": { tr: "Galler", de: "Wales" },
  "Greece": { tr: "Yunanistan", de: "Griechenland" },
  "Czech Republic": { tr: "Çekya", de: "Tschechien" },
  "Czechia": { tr: "Çekya", de: "Tschechien" },
  "Serbia": { tr: "Sırbistan", de: "Serbien" },
  "Ukraine": { tr: "Ukrayna", de: "Ukraine" },
  "Russia": { tr: "Rusya", de: "Russland" },
  "Hungary": { tr: "Macaristan", de: "Ungarn" },
  "Romania": { tr: "Romanya", de: "Rumänien" },
  "Ireland": { tr: "İrlanda", de: "Irland" },
  "Brazil": { tr: "Brezilya", de: "Brasilien" },
  "Argentina": { tr: "Arjantin", de: "Argentinien" },
  "Uruguay": { tr: "Uruguay", de: "Uruguay" },
  "Colombia": { tr: "Kolombiya", de: "Kolumbien" },
  "Chile": { tr: "Şili", de: "Chile" },
  "Peru": { tr: "Peru", de: "Peru" },
  "Mexico": { tr: "Meksika", de: "Mexiko" },
  "USA": { tr: "ABD", de: "USA" },
  "United States": { tr: "ABD", de: "USA" },
  "Canada": { tr: "Kanada", de: "Kanada" },
  "Japan": { tr: "Japonya", de: "Japan" },
  "South Korea": { tr: "Güney Kore", de: "Südkorea" },
  "Korea Republic": { tr: "Güney Kore", de: "Südkorea" },
  "Australia": { tr: "Avustralya", de: "Australien" },
  "Saudi Arabia": { tr: "Suudi Arabistan", de: "Saudi-Arabien" },
  "Qatar": { tr: "Katar", de: "Katar" },
  "Iran": { tr: "İran", de: "Iran" },
  "Morocco": { tr: "Fas", de: "Marokko" },
  "Senegal": { tr: "Senegal", de: "Senegal" },
  "Nigeria": { tr: "Nijerya", de: "Nigeria" },
  "Egypt": { tr: "Mısır", de: "Ägypten" },
  "Ghana": { tr: "Gana", de: "Ghana" },
  "Cameroon": { tr: "Kamerun", de: "Kamerun" },
  "Ivory Coast": { tr: "Fildişi Sahili", de: "Elfenbeinküste" },
  "Tunisia": { tr: "Tunus", de: "Tunesien" },
  "Algeria": { tr: "Cezayir", de: "Algerien" },
  "South Africa": { tr: "Güney Afrika", de: "Südafrika" },
  "Ecuador": { tr: "Ekvador", de: "Ecuador" },
  "Paraguay": { tr: "Paraguay", de: "Paraguay" },
  "Costa Rica": { tr: "Kosta Rika", de: "Costa Rica" },
  "New Zealand": { tr: "Yeni Zelanda", de: "Neuseeland" },

  // ── Clubs (only those whose Turkish spelling differs from the API name) ──
  // Germany
  "Bayern München": { tr: "Bayern Münih", de: "Bayern München" },
  "Bayern Munich": { tr: "Bayern Münih", de: "Bayern München" },
  "Borussia Mönchengladbach": { tr: "Borussia Mönchengladbach", de: "Borussia Mönchengladbach" },
  "1. FC Köln": { tr: "Köln", de: "1. FC Köln" },
  "FC Koln": { tr: "Köln", de: "1. FC Köln" },
  // Italy
  "Inter": { tr: "Inter", de: "Inter Mailand" },
  "AC Milan": { tr: "Milan", de: "AC Mailand" },
  "Juventus": { tr: "Juventus", de: "Juventus Turin" },
  // Spain
  "Atletico Madrid": { tr: "Atletico Madrid", de: "Atlético Madrid" },
  // Portugal
  "Sporting CP": { tr: "Sporting Lizbon", de: "Sporting Lissabon" },
  "Sporting Lisbon": { tr: "Sporting Lizbon", de: "Sporting Lissabon" },
  "Benfica": { tr: "Benfica", de: "Benfica Lissabon" },
  // Netherlands
  "PSV Eindhoven": { tr: "PSV", de: "PSV Eindhoven" },
  // Turkey (API returns ASCII spelling — restore Turkish diacritics)
  "Fenerbahce": { tr: "Fenerbahçe", de: "Fenerbahce" },
  "Besiktas": { tr: "Beşiktaş", de: "Besiktas" },
  "Istanbul Basaksehir": { tr: "İstanbul Başakşehir", de: "Istanbul Basaksehir" },
  "Basaksehir": { tr: "Başakşehir", de: "Basaksehir" },
  "Caykur Rizespor": { tr: "Çaykur Rizespor", de: "Caykur Rizespor" },
  "Rizespor": { tr: "Rizespor", de: "Rizespor" },
  "Goztepe": { tr: "Göztepe", de: "Göztepe" },
  "Kasimpasa": { tr: "Kasımpaşa", de: "Kasımpaşa" },
  "Gaziantep FK": { tr: "Gaziantep", de: "Gaziantep FK" },
  "Eyupspor": { tr: "Eyüpspor", de: "Eyüpspor" },
  "Bodrumspor": { tr: "Bodrumspor", de: "Bodrumspor" },
};

function locTeam(name, t) {
  if (!name) return name;
  var lang = (t && t._lang) || "en";
  if (lang === "en") return name;
  var entry = TEAM_NAMES[name];
  return (entry && entry[lang]) ? entry[lang] : name;
}


// Rich fallback so the UI looks like a real stats site even before a key is added
const MOCK = {
  football: [], // football uses real API only; no fabricated data
  basketball: [
    { id: "bk1", home: "Lakers", away: "Celtics", homeLogo: null, awayLogo: null,
      time: "03:00", date: "23.06", league: "NBA", status: "upcoming", score: null,
      stats: { referee: "Scott Foster", stadium: "Crypto.com Arena", city: "Los Angeles",
        homeForm: ["W","L","W","W","W"], awayForm: ["W","W","W","L","W"], homeRank: 4, awayRank: 1,
        homeSquad: ["James","Davis","Reaves","Russell","Hachimura"], awaySquad: ["Tatum","Brown","White","Holiday","Porzingis"],
        channels: ["ESPN"], h2h: { total: 30, homeWins: 14, awayWins: 16, draws: 0 }, comments: [] } },
  ],
  motorsport: [
    { id: "f1a", home: "British GP - Silverstone", away: "", homeLogo: null, awayLogo: null,
      time: "16:00", date: "28.06", league: "Formula 1", status: "upcoming", score: null,
      stats: { referee: "Niels Wittich", stadium: "Silverstone Circuit", city: "Silverstone",
        homeForm: ["VER","NOR","VER","LEC","VER"], awayForm: [], homeRank: null, awayRank: null,
        homeSquad: ["P1 Verstappen","P2 Norris","P3 Leclerc","P4 Piastri","P5 Sainz","P6 Hamilton","P7 Russell"],
        awaySquad: [], channels: ["S Sport"], h2h: { total: 0, homeWins: 0, awayWins: 0, draws: 0 }, comments: [] } },
  ],
  tennis: [
    { id: "tn1", home: "Djokovic", away: "Alcaraz", homeLogo: null, awayLogo: null,
      time: "15:00", date: "25.06", league: "Wimbledon", status: "upcoming", score: null,
      stats: { referee: "M. Lahyani", stadium: "Centre Court", city: "London",
        homeForm: ["W","W","W","W","W"], awayForm: ["W","W","W","L","W"], homeRank: 2, awayRank: 1,
        homeSquad: ["ATP #2","Grand Slam: 24","Wimbledon: 7"], awaySquad: ["ATP #1","Grand Slam: 4","Wimbledon: 2"],
        channels: ["Eurosport"], h2h: { total: 10, homeWins: 4, awayWins: 6, draws: 0 }, comments: [] } },
  ],
};

// ─── components ───
function TeamLogo({ src, name, size }) {
  var s = size || 22;
  if (src) return <img src={src} alt="" style={{ width: s, height: s, objectFit: "contain", flexShrink: 0 }} />;
  return <div style={{ width: s, height: s, borderRadius: 6, background: COLORS.accentDim, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.accent, fontSize: s*0.45, fontWeight: 800 }}>
    {name ? name[0] : "?"}</div>;
}

function FormBadge({ result }) {
  var c = { W: COLORS.purple, D: "#F8DE22", L: "#FF0000" };
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 24, height: 24, borderRadius: 7, fontSize: 10, fontWeight: 700,
    background: (c[result] || COLORS.textMuted) + "1F", color: c[result] || COLORS.textSecondary, marginRight: 4 }}>{result}</span>;
}

function StatRow({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0",
    borderBottom: "1px solid " + COLORS.border }}>
    <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{label}</span>
    <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{value}</span></div>;
}

// Sport category tab: icon on top, label below, tube-light glow when active.
// Slides its content in from left/right when slideKey changes (category switch).
function SlidePanel({ slideKey, dir, children }) {
  // Render children DIRECTLY (no stale "shown" state) so async data updates always show.
  // Only trigger the slide-in animation when slideKey changes (category switch).
  var [enter, setEnter] = useState(false);
  var keyRef = useRef(slideKey);

  useEffect(function(){
    if (slideKey === keyRef.current) return;
    keyRef.current = slideKey;
    setEnter(true);
    var id = setTimeout(function(){ setEnter(false); }, 20);
    return function(){ clearTimeout(id); };
  }, [slideKey]);

  var offset = (dir >= 0 ? 1 : -1) * 26;
  return <div style={{ position: "relative", overflow: "hidden" }}>
    <div style={{
      opacity: enter ? 0 : 1,
      transform: enter ? "translateX(" + offset + "px)" : "translateX(0)",
      transition: enter ? "none" : "opacity 0.38s cubic-bezier(0.22,1,0.36,1), transform 0.38s cubic-bezier(0.22,1,0.36,1)" }}>
      {children}
    </div>
  </div>;
}

function SportTab({ active, onClick, icon, label, live }) {
  var [hover, setHover] = useState(false);
  var [imgOk, setImgOk] = useState(true);
  // dark mode: inactive tab names in the underline's purple (not grey); light navbar keeps white via .mo-navlight
  var color = active ? COLORS.accent : (hover ? COLORS.textPrimary : (CURRENT_THEME === "dark" ? COLORS.accent : COLORS.textSecondary));
  return <button onClick={onClick} onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
    style={{ flexShrink: 0, position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
      padding: "12px 16px 9px", border: "none", cursor: "pointer",
      background: hover ? "rgba(128,128,145,0.16)" : "transparent", transition: "background 0.2s ease",
      borderRadius: 16, WebkitTapHighlightColor: "transparent", fontFamily: FONT,
      minWidth: 64 }}>
    <span style={{ position: "relative", zIndex: 1, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {imgOk
        ? <img src={icon} alt="" onError={function(){ setImgOk(false); }}
            style={{ width: 24, height: 24, objectFit: "contain" }} />
        : <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />}
      {live && active && <span style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: "50%",
        background: COLORS.red, animation: "pulse 1.5s infinite" }} />}
    </span>
    <span style={{ position: "relative", zIndex: 1, fontSize: 11, fontWeight: active ? 700 : 600, color: color,
      transition: "color 0.3s ease", whiteSpace: "nowrap" }}>{label}</span>
  </button>;
}

function SportButton({ active, onClick, children }) {
  var [ripple, setRipple] = useState(null);
  var [hovered, setHovered] = useState(false);
  var ref = useRef(null);
  function enter(e) {
    var r = ref.current.getBoundingClientRect();
    setRipple({ x: e.clientX - r.left, y: e.clientY - r.top, size: Math.max(r.width, r.height) * 2.5, id: Date.now() });
    setHovered(true);
  }
  return <button ref={ref} onClick={onClick} onMouseEnter={enter} onMouseLeave={function(){ setRipple(null); setHovered(false); }}
    style={{ flexShrink: 0, position: "relative", overflow: "hidden", padding: "10px 20px",
      border: "1px solid " + (active ? COLORS.accent + "55" : COLORS.border), borderRadius: 18,
      fontSize: 13, fontWeight: active ? 700 : 600, cursor: "pointer",
      background: active ? COLORS.accentDim : COLORS.card, color: (active || hovered) ? COLORS.accent : COLORS.textSecondary,
      transition: "color 0.4s, background 0.4s, border-color 0.4s", fontFamily: FONT }}>
    {ripple && <span key={ripple.id} style={{ position: "absolute", borderRadius: "50%", width: ripple.size, height: ripple.size,
      left: ripple.x - ripple.size/2, top: ripple.y - ripple.size/2, background: COLORS.accent,
      animation: "rippleFill 0.8s cubic-bezier(0.16,1,0.3,1) forwards", pointerEvents: "none" }} />}
    <span style={{ position: "relative", zIndex: 1 }}>{children}</span></button>;
}

function CommentSection({ match, t }) {
  var [v, setV] = useState("");
  var [list, setList] = useState([]);
  var ctx = match ? { targetType: "match", targetId: match.id, matchId: match.id,
    targetName: (match.home || "") + " - " + (match.away || ""), sport: "football",
    meta: Object.assign({ type: "match" }, matchSnap(match)) } : null;
  useEffect(function(){
    if (!ctx) return;
    var cancelled = false;
    // match by target_id OR match_id so every comment on this match shows (not just mine)
    fetchMatchComments(match.id).then(function(rows){
      if (!cancelled) setList(rows.map(function(c){ return { user: c.user, user_id: c.user_id, text: c.text, time: fmtCommentTime(c.created_at) }; }));
    });
    return function(){ cancelled = true; };
  }, [match && match.id]);
  function submit() {
    var x = v.trim(); if (!x || !ctx) return;
    setList([{ user: "sen", text: x, time: t.now }].concat(list)); // optimistic
    setV("");
    dbAddComment(Object.assign({}, ctx, { body: x }));
    cmtBump(match.id, 1); // keep the card's comment count in sync
  }
  return <div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <input value={v} onChange={function(e){ setV(e.target.value); }} onKeyDown={function(e){ if (e.key==="Enter") submit(); }}
        placeholder={t.writeComment} style={{ flex: 1, padding: "9px 13px", background: COLORS.cardAlt,
        border: "none", borderRadius: 12, color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT }} />
      <button onClick={submit} style={{ padding: "9px 16px", background: COLORS.accent, border: "none", borderRadius: 12,
        color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>{t.send}</button>
    </div>
    {list.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
    {list.map(function(c, i){ return <div key={i} style={{ padding: "10px 12px", background: COLORS.cardAlt, borderRadius: 12,
      marginBottom: 7, border: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <UserLink userId={c.user_id} username={c.user} t={t} style={{ color: COLORS.accent, fontSize: 12, fontWeight: 700 }} />
        <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{c.time}</span></div>
      <span style={{ color: COLORS.textPrimary, fontSize: 13 }}>{c.text}</span></div>; })}
  </div>;
}

// Animated stat bar: fills from center outward (left half + right half) on mount.
// Pre-match derived stats: season averages comparison
function SeasonStats({ season, home, away, t }) {
  var h = season.home || {};
  var a = season.away || {};
  var rows = [
    [t.matchesPlayed, h.played, a.played, false],
    [t.gfAvg, h.gfAvg, a.gfAvg, true],
    [t.gaAvg, h.gaAvg, a.gaAvg, true],
    [t.cleanSheets, h.cleanSheet, a.cleanSheet, false],
    [t.wins, h.wins, a.wins, false],
    [t.draws, h.draws, a.draws, false],
    [t.loses, h.loses, a.loses, false],
  ].filter(function(r){ return r[1] != null || r[2] != null; });

  function nf(v){ if (v == null) return "-"; var n = parseFloat(v); return isNaN(n) ? v : (Math.round(n*100)/100); }

  return <div>
    <div style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 12, textAlign: "center" }}>{t.seasonAvgNote}</div>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
      <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 800, flex: 1 }}>{home}</span>
      <span style={{ color: COLORS.red, fontSize: 12, fontWeight: 800, flex: 1, textAlign: "right" }}>{away}</span>
    </div>
    {rows.map(function(r, i){
      var hv = parseFloat(r[1]) || 0, av = parseFloat(r[2]) || 0; var tot = (hv+av) || 1;
      return <div key={i} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{nf(r[1])}</span>
          <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>{r[0]}</span>
          <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{nf(r[2])}</span>
        </div>
        <StatBar leftPct={hv/tot*100} rightPct={av/tot*100} delay={i*60} />
      </div>; })}
  </div>;
}

// One event row in the match summary timeline (mackolik-style)
function TimelineRow({ ev, t }) {
  var isHome = ev.side === "home";
  var min = (ev.minute != null ? ev.minute : "") + (ev.extra ? "+" + ev.extra : "") + (ev.minute != null ? "'" : "");

  // icon by event type
  function icon() {
    if (ev.type === "goal") {
      if (ev.detail === "Missed Penalty") return <span style={{ color: COLORS.textMuted, fontSize: 13 }}>✕</span>;
      return <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff",
        border: "2px solid " + COLORS.accent, display: "inline-block" }} />;
    }
    if (ev.type === "card") {
      var col = ev.detail === "Red Card" ? COLORS.red : COLORS.yellow;
      return <span style={{ width: 11, height: 15, borderRadius: 2, background: col, display: "inline-block" }} />;
    }
    if (ev.type === "subst") return <span style={{ display: "inline-flex" }}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={COLORS.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7h10M13 3l4 4-4 4" /><path d="M17 17H7M11 21l-4-4 4-4" /></svg></span>;
    if (ev.type === "var") return <span style={{ fontSize: 9, fontWeight: 800, color: COLORS.textSecondary,
      border: "none", borderRadius: 4, padding: "1px 3px" }}>VAR</span>;
    return <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.textMuted, display: "inline-block" }} />;
  }

  var isGoal = ev.type === "goal" && ev.detail !== "Missed Penalty";

  var content = <div style={{ maxWidth: "44%", textAlign: isHome ? "right" : "left" }}>
    <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: isGoal ? 800 : 600 }}>{ev.player}</div>
    {ev.type === "subst" && ev.assist && <div style={{ color: COLORS.red, fontSize: 11 }}>↓ {ev.assist}</div>}
    {isGoal && ev.detail === "Penalty" && <div style={{ color: COLORS.textMuted, fontSize: 10 }}>{t.penalty}</div>}
    {isGoal && ev.detail === "Own Goal" && <div style={{ color: COLORS.textMuted, fontSize: 10 }}>{t.ownGoal}</div>}
    {ev.type === "subst" && ev.player && <div style={{ color: COLORS.accent, fontSize: 11 }}>↑ {ev.player}</div>}
  </div>;

  // For subst, ev.player is OUT, ev.assist is IN. Show IN as main, OUT below.
  var subContent = <div style={{ maxWidth: "44%", textAlign: isHome ? "right" : "left" }}>
    <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, display: "flex", gap: 5,
      justifyContent: isHome ? "flex-end" : "flex-start", alignItems: "center" }}>
      <span style={{ color: COLORS.accent }}>↑</span>{ev.assist || ev.player}</div>
    {ev.assist && ev.player && <div style={{ color: COLORS.textMuted, fontSize: 11, display: "flex", gap: 5,
      justifyContent: isHome ? "flex-end" : "flex-start", alignItems: "center" }}>
      <span style={{ color: COLORS.red }}>↓</span>{ev.player}</div>}
  </div>;

  return <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "10px 0",
    flexDirection: isHome ? "row" : "row-reverse" }}>
    <div style={{ flex: 1, display: "flex", justifyContent: isHome ? "flex-end" : "flex-start" }}>
      {ev.type === "subst" ? subContent : content}
    </div>
    <div style={{ width: 64, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, zIndex: 1 }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: COLORS.bg, border: "none",
        display: "flex", alignItems: "center", justifyContent: "center" }}>{icon()}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.textSecondary }}>{min}</span>
      {ev.score && <span style={{ fontSize: 11, fontWeight: 800, color: COLORS.accent }}>{ev.score}</span>}
    </div>
    <div style={{ flex: 1 }} />
  </div>;
}

// One event row in the match summary timeline placeholder end
function CascadeItem({ index, children }) {
  var [show, setShow] = useState(false);
  useEffect(function(){
    var id = setTimeout(function(){ setShow(true); }, 60 + (index || 0) * 85);
    return function(){ clearTimeout(id); };
  }, []);
  return <div style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(10px)",
    transition: "opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
    {children}</div>;
}

function StatBar({ leftPct, rightPct, delay, leftColor, rightColor }) {
  var [grow, setGrow] = useState(false);
  var lc = leftColor || COLORS.accent;
  var rc = rightColor || COLORS.red;
  useEffect(function(){
    var id = setTimeout(function(){ setGrow(true); }, (delay || 0) + 40);
    return function(){ clearTimeout(id); };
  }, []);
  var ease = "width 0.7s cubic-bezier(0.22,1,0.36,1)";
  return <div style={{ height: 6, borderRadius: 4, background: COLORS.cardAlt, overflow: "hidden",
    display: "flex", justifyContent: "center" }}>
    <div style={{ width: "50%", display: "flex", justifyContent: "flex-end", overflow: "hidden" }}>
      <div style={{ width: grow ? leftPct + "%" : "0%", height: "100%", background: lc,
        borderTopLeftRadius: 4, borderBottomLeftRadius: 4, transition: ease }} />
    </div>
    <div style={{ width: "50%", display: "flex", justifyContent: "flex-start", overflow: "hidden" }}>
      <div style={{ width: grow ? rightPct + "%" : "0%", height: "100%", background: rc,
        borderTopRightRadius: 4, borderBottomRightRadius: 4, transition: ease }} />
    </div>
  </div>;
}

// Renders a team's starting XI on a football pitch using API grid "row:col".
// subbedOutIds: Set of player ids who were substituted off (red arrow).
// Player match rating -> badge color: 7+ green, 6-7 yellow, <6 red, missing gray.
function ratingColor(r){ if (r == null) return COLORS.textMuted; if (r >= 7) return COLORS.purple; if (r >= 6) return COLORS.yellow; return COLORS.red; }
function RatingBadge({ rating, style }) {
  if (rating == null) return null;
  return <span style={Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 26, padding: "1px 5px", borderRadius: 6, fontSize: 11, fontWeight: 800, color: "#fff",
    background: ratingColor(rating) }, style || {})}>{rating.toFixed(1)}</span>;
}

function Jersey({ number, color, out }) {
  var fill = color || "#ffffff";
  var hex = fill.replace("#", "");
  var r = parseInt(hex.substring(0,2),16); var g = parseInt(hex.substring(2,4),16); var b = parseInt(hex.substring(4,6),16);
  if (isNaN(r)) { r = 255; g = 255; b = 255; }
  var lum = (0.299*r + 0.587*g + 0.114*b);
  var txt = lum > 150 ? "#15543f" : "#ffffff";
  return <div style={{ position: "relative", width: 44, height: 42 }}>
    <svg viewBox="0 0 40 38" width="44" height="42" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }}>
      <path d="M14 2 L26 2 L38 9 L33 16 L29 13 L29 36 L11 36 L11 13 L7 16 L2 9 Z"
        fill={fill} stroke="rgba(0,0,0,0.18)" strokeWidth="1" strokeLinejoin="round" />
    </svg>
    <span style={{ position: "absolute", left: 0, right: 0, top: 11, display: "flex", alignItems: "center", justifyContent: "center",
      color: txt, fontSize: 15, fontWeight: 800 }}>{number != null ? number : ""}</span>
    {out && <span style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%",
      background: COLORS.red, display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7h10M13 3l4 4-4 4" /><path d="M17 17H7M11 21l-4-4 4-4" /></svg>
    </span>}
  </div>;
}

// Player head shot for the pitch (falls back to a numbered disc when no photo / image fails).
// White disc holding a small icon — for markers over the green pitch.
function PitchDisc({ size, children, style }) {
  return <span style={Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }, style || {})}>{children}</span>;
}

function PlayerHead({ photo, number, name, out }) {
  var [ok, setOk] = useState(!!photo);
  var s = 44;
  var ring = "2px solid rgba(255,255,255,0.85)";
  var shadow = "0 2px 5px rgba(0,0,0,0.35)";
  return <div style={{ position: "relative", width: s, height: s }}>
    {photo && ok
      ? <img src={photo} alt="" onError={function(){ setOk(false); }}
          style={{ width: s, height: s, borderRadius: "50%", objectFit: "cover", border: ring, boxShadow: shadow, background: "#fff" }} />
      : <div style={{ width: s, height: s, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.92)", border: ring, boxShadow: shadow, color: "#15543f", fontSize: 15, fontWeight: 800 }}>
          {number != null ? number : (name ? name[0] : "")}</div>}
    {out && <span style={{ position: "absolute", top: -4, left: -4, width: 18, height: 18, borderRadius: "50%",
      background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
      <MaskIcon src="/swap_icon.png" size={11} color="#fff" /></span>}
  </div>;
}

// Goal (purple ball PNG) + assist (purple boot, masked). One icon language, no emoji.
function GoalAssistIcons({ g, a, style }) {
  if (!g && !a) return null;
  return <span style={Object.assign({ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, lineHeight: 1 }, style || {})}>
    {g > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <img src="/goal_icon.png" alt="gol" style={{ width: 13, height: 13, display: "block" }} />{g > 1 && <span>{g}</span>}</span>}
    {a > 0 && <span title="asist" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <MaskIcon src="/assist_icon.png" size={13} color={COLORS.accent} />{a > 1 && <span>{a}</span>}</span>}
  </span>;
}

function Pitch({ lineup, subbedOut, flip, label, color, ratings, players, goals, assists, onPlayerClick, highlight }) {
  var starting = lineup.starting || [];
  var rows = {};
  var hasGrid = false;
  starting.forEach(function (p) {
    if (p.grid) {
      hasGrid = true;
      var parts = p.grid.split(":");
      var r = parseInt(parts[0], 10);
      if (!rows[r]) rows[r] = [];
      rows[r].push({ p: p, col: parseInt(parts[1], 10) });
    }
  });

  // API sometimes omits grid/formation (e.g. some Süper Lig fixtures). Synthesize a layout
  // from the player positions (G/D/M/F) so the side still renders on the pitch.
  var synth = false;
  if (!hasGrid && starting.length > 0) {
    var posRow = { G: 1, D: 2, M: 3, F: 4 };
    var anyPos = starting.some(function (p) { return p.position && posRow[p.position]; });
    if (anyPos) {
      synth = true;
      var colCount = {};
      starting.forEach(function (p) {
        var r = posRow[p.position] || 3; // unknown -> midfield
        if (!rows[r]) rows[r] = [];
        colCount[r] = (colCount[r] || 0) + 1;
        rows[r].push({ p: p, col: colCount[r] });
      });
    } else {
      // neither grid nor positions: lay startXI out by index into a default shape (GK-DEF-MID-FWD)
      synth = true;
      var n = starting.length;
      var rest = n - 1;
      var def = Math.round(rest * 0.36), mid = Math.round(rest * 0.34);
      var fwd = rest - def - mid;
      var layout = [1, def, mid, fwd].filter(function (c) { return c > 0; });
      var idx = 0;
      layout.forEach(function (cnt, ri) {
        rows[ri + 1] = [];
        for (var c = 0; c < cnt && idx < n; c++) { rows[ri + 1].push({ p: starting[idx], col: c + 1 }); idx++; }
      });
      while (idx < n) { // leftover from rounding -> last row
        var last = layout.length;
        if (!rows[last]) rows[last] = [];
        rows[last].push({ p: starting[idx], col: rows[last].length + 1 });
        idx++;
      }
    }
  }

  if (!hasGrid && !synth) {
    return <div>
      <div style={{ color: COLORS.accent, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{label}{lineup.formation ? "  ·  " + lineup.formation : ""}</div>
      {starting.map(function(p, i){
        var out = subbedOut && subbedOut[p.id];
        var pdata = players && players[p.id];
        var clickable = onPlayerClick && pdata;
        return <div key={i} onClick={clickable ? function(){ onPlayerClick(pdata); } : undefined}
          style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 500, padding: "5px 0",
          borderBottom: "1px solid " + COLORS.border, display: "flex", gap: 6, alignItems: "center",
          cursor: clickable ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
          <span style={{ color: COLORS.textMuted, fontSize: 11, width: 18, textAlign: "right" }}>{p.shirt != null ? p.shirt : (i+1)}</span>
          <span style={{ flex: 1 }}>{p.name}</span>
          <GoalAssistIcons g={goals && goals[p.id]} a={assists && assists[p.id]} style={{ color: COLORS.textSecondary }} />
          {ratings && ratings[p.id] != null && <RatingBadge rating={ratings[p.id]} />}
          {out && <span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "50%", background: COLORS.red,
            alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h10M13 3l4 4-4 4" /><path d="M17 17H7M11 21l-4-4 4-4" /></svg></span>}
        </div>; })}
    </div>;
  }

  var rowNums = Object.keys(rows).map(Number).sort(function(a,b){ return a-b; });

  return <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6 }}>
      <span style={{ color: COLORS.accent, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{label}</span>
      {lineup.formation && <span style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{lineup.formation}</span>}
    </div>
    <div style={{ perspective: "1150px", paddingTop: 4, maxWidth: 340, margin: "0 auto" }}>
    <div style={{ position: "relative", width: "100%", aspectRatio: "68 / 94",
      background: "repeating-linear-gradient(180deg, #1f7a4c 0px, #1f7a4c 10%, #258253 10%, #258253 20%)",
      borderRadius: 14, overflow: "visible",
      border: "1px solid rgba(255,255,255,0.3)", display: "flex", flexDirection: "column",
      padding: "10px 2px", boxShadow: "inset 0 0 26px rgba(0,0,0,0.14)",
      transform: "rotateX(24deg)", transformOrigin: "50% 58%", transformStyle: "preserve-3d" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "rgba(255,255,255,0.45)" }} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 46, height: 46, marginLeft: -23, marginTop: -23,
        border: "2px solid rgba(255,255,255,0.45)", borderRadius: "50%" }} />
      <div style={{ position: "absolute", left: "50%", top: 0, width: 66, height: 24, marginLeft: -33,
        border: "2px solid rgba(255,255,255,0.45)", borderTop: "none", borderTopLeftRadius: 0 }} />
      <div style={{ position: "absolute", left: "50%", bottom: 0, width: 66, height: 24, marginLeft: -33,
        border: "2px solid rgba(255,255,255,0.45)", borderBottom: "none" }} />

      {(flip ? rowNums.slice().reverse() : rowNums).map(function(rn){
        var line = rows[rn].slice().sort(function(a,b){ return a.col - b.col; });
        if (flip) line.reverse();
        return <div key={rn} style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "center",
          position: "relative", zIndex: 1, transformStyle: "preserve-3d" }}>
          {line.map(function(cell, i){
            var p = cell.p;
            var out = subbedOut && subbedOut[p.id];
            var pdata = players && players[p.id];
            var clickable = onPlayerClick && pdata;
            return <div key={i} onClick={clickable ? function(){ onPlayerClick(pdata); } : undefined}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 68,
                cursor: clickable ? "pointer" : "default", WebkitTapHighlightColor: "transparent",
                transform: "rotateX(-24deg)", transformOrigin: "bottom center" }}>
              <div style={{ position: "relative" }}>
                <span style={{ display: "inline-block", borderRadius: "50%", boxShadow: (highlight && highlight[p.id]) ? "0 0 0 3px " + COLORS.accent : "none" }}>
                  <PlayerHead photo={(pdata && pdata.photo) || p.photo} number={p.shirt} name={p.name} out={out} />
                </span>
                {ratings && ratings[p.id] != null && <RatingBadge rating={ratings[p.id]} style={{ position: "absolute", bottom: -5, left: "50%",
                  transform: "translateX(-50%)", minWidth: 0, padding: "1px 6px", fontSize: 12, borderRadius: 6,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.45)" }} />}
                {(function(){
                  var g = (goals && goals[p.id]) || 0, a = (assists && assists[p.id]) || 0;
                  if (!g && !a) return null;
                  var goalRow = [];
                  for (var gi = 0; gi < Math.min(g, 4); gi++) goalRow.push(
                    <PitchDisc key={"g" + gi} size={17} style={{ marginLeft: gi ? -7 : 0, zIndex: gi }}>
                      <img src="/goal_icon.png" alt="gol" style={{ width: 13, height: 13, display: "block" }} /></PitchDisc>);
                  return <div style={{ position: "absolute", top: -7, right: -9, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    {g > 0 && <div style={{ display: "flex", alignItems: "center" }}>{goalRow}</div>}
                    {a > 0 && <PitchDisc size={17}><MaskIcon src="/assist_icon.png" size={11} color={COLORS.accent} /></PitchDisc>}
                  </div>;
                })()}
              </div>
              <span style={{ color: "#fff", fontSize: 11, fontWeight: 500, marginTop: 5, textAlign: "center",
                textShadow: "0 1px 3px rgba(0,0,0,0.65)", lineHeight: 1.1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 72 }}>
                {p.name.split(" ").slice(-1)[0]}</span>
            </div>; })}
        </div>; })}
    </div>
    </div>
  </div>;
}

// WMO weather code -> localized short label
function wxLabel(code, t) {
  if (code == null) return "";
  if (code === 0) return t.wxClear;
  if (code <= 3) return t.wxCloudy;
  if (code === 45 || code === 48) return t.wxFog;
  if (code >= 51 && code <= 67) return t.wxRain;
  if (code >= 71 && code <= 77) return t.wxSnow;
  if (code >= 80 && code <= 82) return t.wxShowers;
  if (code >= 95) return t.wxStorm;
  return t.wxCloudy;
}

// IMDb-style rating slider (0-10). Fill color sweeps red -> green -> purple smoothly with value.
function RatingSlider({ value, onChange, min }) {
  var ref = useRef(null);
  var lo = min || 0; // floor (ratings realistically start ~3.0)
  function setFromX(clientX) {
    var el = ref.current; if (!el) return;
    var r = el.getBoundingClientRect();
    var pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round((lo + pct * (10 - lo)) * 10) / 10);
  }
  function down(e) {
    e.preventDefault();
    setFromX(e.clientX);
    function move(ev){ setFromX(ev.clientX); }
    function up(){ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  var pct = Math.min(100, Math.max(0, (value - lo) / (10 - lo) * 100));
  // skewed so red dominates the low end: ~0-3.5 stays red/orange, then green, then purple
  var hue = Math.round(Math.pow(value / 10, 1.7) * 280); // 0 red -> green -> 280 purple
  var col = "hsl(" + hue + ", 78%, 52%)";
  return <div ref={ref} onPointerDown={down}
    onTouchStart={function(e){ e.stopPropagation(); }} onTouchMove={function(e){ e.stopPropagation(); }}
    style={{ position: "relative", height: 12, borderRadius: 7, background: COLORS.cardAlt,
    cursor: "pointer", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct + "%", borderRadius: 7, background: col,
      transition: "background 0.25s ease" }} />
    <div style={{ position: "absolute", left: pct + "%", top: "50%", width: 20, height: 20, borderRadius: "50%", background: "#fff",
      border: "3px solid " + col, transform: "translate(-50%,-50%)", boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
      transition: "border-color 0.25s ease" }} />
  </div>;
}

// Bottom sheet with one player's per-match stats. Rows cascade in on open.
function PlayerMatchSheet({ player, matchId, matchName, match, t, onClose }) {
  var [visible, setVisible] = useState(false);
  var [userRating, setUserRating] = useState(function(){ return (player && player.rating != null) ? player.rating : 5; });
  var [ratingSubmitted, setRatingSubmitted] = useState(false);
  var [pComment, setPComment] = useState("");
  var [pComments, setPComments] = useState([]);
  var overlayRef = useRef(null);
  var rCtx = (player && player.id != null && matchId != null)
    ? { targetType: "player", targetId: player.id, matchId: matchId, targetName: player.name, matchName: matchName || null, sport: "football",
        meta: { type: "player", playerId: player.id, name: player.name, photo: player.photo,
          goals: player.goals, assists: player.assists, yellow: player.yellow, red: player.red, rating: player.rating,
          match: matchSnap(match) } } : null;
  // load this user's prior rating + everyone's comments for this player-in-this-match
  useEffect(function(){
    if (!rCtx) return;
    var cancelled = false;
    fetchMyRating({ targetType: "player", targetId: player.id, matchId: matchId }).then(function(r){
      if (!cancelled && r != null) { setUserRating(r); setRatingSubmitted(true); }
    });
    fetchComments({ targetType: "player", targetId: player.id, matchId: matchId }).then(function(rows){
      if (!cancelled) setPComments(rows.map(function(c){ return { user: c.user, text: c.text, time: fmtCommentTime(c.created_at) }; }));
    });
    return function(){ cancelled = true; };
  }, [player && player.id, matchId]);
  function submitRating(){
    setRatingSubmitted(true); // optimistic
    if (rCtx) saveRating(Object.assign({}, rCtx, { rating: userRating }));
  }
  function addComment(){
    var x = pComment.trim(); if (!x) return;
    setPComments([{ user: "sen", text: x, time: t.now }].concat(pComments)); // optimistic
    setPComment("");
    if (rCtx) dbAddComment(Object.assign({}, rCtx, { body: x }));
  }
  useEffect(function(){
    var r = requestAnimationFrame(function(){ setVisible(true); });
    function onKey(e){ if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    // block background scroll only when the gesture is on the backdrop (so the sheet itself can still scroll its content)
    var ov = overlayRef.current;
    function block(e){ if (e.target === ov) e.preventDefault(); }
    if (ov) { ov.addEventListener("wheel", block, { passive: false }); ov.addEventListener("touchmove", block, { passive: false }); }
    // freeze the match-detail scroller behind us so it can't scroll/move while the sheet is open
    // (scrollbars are CSS-hidden, so overflow:hidden causes no width shift)
    var scroller = ov ? ov.closest(".mo-scroll") : null;
    var prevOv = scroller ? scroller.style.overflow : "";
    if (scroller) scroller.style.overflow = "hidden";
    return function(){
      cancelAnimationFrame(r); window.removeEventListener("keydown", onKey);
      if (ov) { ov.removeEventListener("wheel", block); ov.removeEventListener("touchmove", block); }
      if (scroller) scroller.style.overflow = prevOv;
    };
  }, []);
  function close(){ setVisible(false); setTimeout(onClose, 280); }
  var drag = useSheetDrag(close); // swipe the sheet down to dismiss

  var p = player || {};
  function shotsVal(){ var tot = p.shotsTotal || 0; return tot + (p.shotsOn ? " (" + p.shotsOn + ")" : ""); }
  var rows = [
    [t.plGoals, (p.goals || 0)],
    [t.plAssists, (p.assists || 0)],
    [t.shots, shotsVal()],
    [t.totalPasses, (p.passesTotal != null ? p.passesTotal : "-")],
    [t.pmPassAcc, (p.passesPct != null ? p.passesPct + "%" : "-")],
    [t.pmDribbles, (p.dribbleSuccess || 0) + "/" + (p.dribbleAttempts || 0)],
    [t.fouls, (p.foulsCommitted || 0)],
    [t.plMinutes, (p.minutes != null ? p.minutes : 0) + "'"],
  ];

  if (typeof document === "undefined") return null;
  return createPortal(<div ref={overlayRef} onClick={close}
    onTouchStart={function(e){ e.stopPropagation(); }} onTouchMove={function(e){ e.stopPropagation(); }} onTouchEnd={function(e){ e.stopPropagation(); }}
    style={{ position: "fixed", inset: 0, zIndex: 1300, display: "flex",
    alignItems: "flex-end", justifyContent: "center",
    background: visible ? "rgba(12,14,18,0.5)" : "rgba(12,14,18,0)", transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} {...drag.handlers} style={{ width: "100%", maxWidth: 480, background: "var(--modalGrad)",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      borderTopLeftRadius: 24, borderTopRightRadius: 24, border: "1px solid var(--modalBorder)", borderBottom: "none",
      padding: "12px 20px max(24px, env(safe-area-inset-bottom))", fontFamily: FONT, touchAction: "pan-y",
      maxHeight: "90vh", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain",
      transform: visible ? ("translateY(" + drag.dragY + "px)") : "translateY(100%)",
      transition: drag.dragging ? "none" : "transform 0.34s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 14px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {p.photo
          ? <img src={p.photo} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
              border: "2px solid " + COLORS.accent }} />
          : <span style={{ width: 48, height: 48, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 18, fontWeight: 700 }}>
              {p.name ? p.name[0] : "?"}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{t.pmTitle}</div>
        </div>
        {p.rating != null && <RatingBadge rating={p.rating} style={{ fontSize: 13, padding: "3px 8px", minWidth: 40 }} />}
        {p.id != null && <FavButton kind="player" refId={p.id} name={p.name} image={p.photo} size={34} />}
      </div>
      <div>
        {rows.map(function(r, i){
          return <CascadeItem key={i} index={i}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid " + COLORS.border }}>
              <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{r[0]}</span>
              <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{r[1]}</span>
            </div>
          </CascadeItem>; })}
      </div>

      {/* user rating: IMDb-style slider, color sweeps with the value */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid " + COLORS.border }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700 }}>{t.yourRating}</span>
          <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800 }}>{userRating.toFixed(1)}</span>
        </div>
        <RatingSlider value={userRating} onChange={function(v){ setUserRating(v); setRatingSubmitted(false); }} />
        <button onClick={submitRating} disabled={ratingSubmitted}
          style={{ marginTop: 12, width: "100%", padding: "10px 16px", borderRadius: 12, border: "none",
            background: ratingSubmitted ? COLORS.cardAlt : COLORS.accent, color: ratingSubmitted ? COLORS.textSecondary : "#fff",
            fontWeight: 800, fontSize: 14, cursor: ratingSubmitted ? "default" : "pointer", fontFamily: FONT, transition: "all 0.2s",
            WebkitTapHighlightColor: "transparent" }}>
          {ratingSubmitted ? (t.rateSaved + " · " + userRating.toFixed(1)) : t.rateSubmit}
        </button>
      </div>

      {/* performance note: free-text comment on this player's match */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid " + COLORS.border }}>
        <div style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t.perfComment}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={pComment} onChange={function(e){ setPComment(e.target.value); }}
            onKeyDown={function(e){ if (e.key === "Enter") addComment(); }}
            placeholder={t.writeComment} style={{ flex: 1, minWidth: 0, padding: "9px 13px", background: COLORS.cardAlt,
              border: "none", borderRadius: 12, color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT }} />
          <button onClick={addComment} style={{ padding: "9px 16px", background: COLORS.accent, border: "none", borderRadius: 12,
            color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, flexShrink: 0 }}>{t.send}</button>
        </div>
        {pComments.map(function(c, i){ return <div key={i} style={{ marginTop: 8, padding: "10px 12px", background: COLORS.cardAlt,
          borderRadius: 12, border: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 700 }}>@{c.user}</span>
            <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{c.time}</span></div>
          <span style={{ color: COLORS.textPrimary, fontSize: 13 }}>{c.text}</span></div>; })}
      </div>
    </div>
  </div>, document.body);
}

// Prediction coupon: 1X2 + man of the match + 3 player-rating picks. Editable until kickoff,
// then locked; after scoring it shows the points earned. The app's marquee retention hook.
function PredictionCoupon({ match, t }) {
  var fav = useFavorites(); // re-render on login change
  var locked = match.status !== "upcoming"; // deadline = kickoff
  var [mine, setMine] = useState(undefined); // undefined=loading | null=none | row
  var [cand, setCand] = useState(null);
  var [onextwo, setOnextwo] = useState(null);
  var [motm, setMotm] = useState(null);
  var [ratings, setRatings] = useState([]); // up to 3: 1 system suggestion + 2 user-picked
  var [pickFor, setPickFor] = useState(null); // "motm" | "rating" | null
  var [pside, setPside] = useState("home"); // which team's pitch is shown for rating picks
  var [ratingEdit, setRatingEdit] = useState(null); // player being rated in the editor sheet
  var [editVal, setEditVal] = useState(3.0);
  var [q, setQ] = useState("");
  var [saving, setSaving] = useState(false);
  var [saved, setSaved] = useState(false);

  useEffect(function(){
    var cancelled = false;
    if (!match.id || !fav.loggedIn) { setMine(fav.loggedIn ? undefined : null); return; }
    fetchMyPrediction(match.id).then(function(row){ if (!cancelled) setMine(row || null); }).catch(function(){ if (!cancelled) setMine(null); });
    return function(){ cancelled = true; };
  }, [match.id, fav.loggedIn]);

  useEffect(function(){
    if (mine && mine.picks) {
      setOnextwo(mine.picks.onextwo || null);
      setMotm(mine.picks.motm || null);
      setRatings((mine.picks.ratings || []).map(function(r){ return { id: r.id, name: r.name, photo: r.photo, team: r.team, teamId: r.teamId, val: r.pred }; }));
    }
  }, [mine]);

  // finished match with an unscored (or not-yet-rated) coupon -> score it now, then show the points
  useEffect(function(){
    if (!locked || !mine || match.status !== "finished" || !match.id) return;
    if (mine.scored && mine.rated) return; // already fully scored
    fetch("/api/predict/score?match=" + match.id)
      .then(function(){ return fetchMyPrediction(match.id); })
      .then(function(row){ if (row) setMine(row); }).catch(function(){});
  }, [locked, match.id, mine && mine.scored, mine && mine.rated]);

  useEffect(function(){
    if (locked || !fav.loggedIn || !match.id || cand) return;
    fetch("/api/football?mode=predcandidates&fixture=" + match.id + "&home=" + (match.homeId || "") + "&away=" + (match.awayId || ""))
      .then(function(r){ return r.json(); })
      .then(function(j){
        j = j || { players: [], rating: [] };
        setCand(j);
        // note: the system's star suggestion (j.rating[0]) is shown pinned above the pitch and is
        // always ringed — it is NOT auto-added to the user's picks (rating it is optional).
      })
      .catch(function(){ setCand({ players: [], rating: [] }); });
  }, [locked, fav.loggedIn, match.id]);

  function save() {
    if (!fav.loggedIn) { if (FAV.onNeedLogin) FAV.onNeedLogin(); return; }
    if (!onextwo && !motm && !(ratings && ratings.length) && !mine) return;
    setSaving(true);
    savePrediction({
      matchId: match.id,
      matchTs: match.ts ? new Date(match.ts).toISOString() : null,
      leagueId: match.leagueId,
      picks: {
        onextwo: onextwo || null,
        motm: motm ? { id: motm.id, name: motm.name } : null,
        ratings: (ratings || []).map(function(r){ return { id: r.id, name: r.name, photo: r.photo, team: r.team, teamId: r.teamId, pred: Math.round(r.val * 10) / 10 }; }),
      },
      meta: matchSnap(match),
    }).then(function(res){
      setSaving(false);
      if (!res.error) { setSaved(true); setMine(res.data || {}); predInvalidate(match.id); setTimeout(function(){ setSaved(false); }, 1800); }
    });
  }

  // purple tint stays, but flat (no bordered "card"). The tab already says "Tahmin", so no header label.
  var box = { background: COLORS.glassPurple, borderRadius: 14, padding: "14px 16px" };
  var head = locked ? <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
    <span style={{ fontSize: 10, fontWeight: 800, color: COLORS.textMuted, background: COLORS.cardAlt, padding: "1px 7px", borderRadius: 6 }}>Kilitli</span>
  </div> : null;

  // not logged in -> prompt (only pre-kickoff)
  if (!fav.loggedIn) {
    if (locked) return null;
    return <div style={{ marginBottom: 16 }}>{head}
      <div style={box}><div style={{ color: COLORS.textSecondary, fontSize: 13 }}>Bu maça tahmin yap, tuttukça itibar puanı kazan.
        <button onClick={function(){ if (FAV.onNeedLogin) FAV.onNeedLogin(); }} style={{ marginLeft: 8, padding: "6px 12px", background: COLORS.accent, color: "#fff", border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>Giriş yap</button>
      </div></div>
    </div>;
  }

  // locked (live/finished): show my coupon read-only + points if scored
  if (locked) {
    if (mine === undefined) return null;
    if (!mine) return null; // didn't predict -> nothing
    return <div style={{ marginBottom: 16 }}>{head}
      <div style={box}>
        {mine.scored
          ? <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: COLORS.accent }}>+{mine.points || 0}</span>
              <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700 }}>itibar puanı kazandın</span>
            </div>
          : <div style={{ color: COLORS.textMuted, fontSize: 12.5, marginBottom: 10 }}>Kupon kilitlendi — maç bitince otomatik puanlanacak.</div>}
        <CouponSummary picks={mine.picks} match={match} t={t} />
      </div>
    </div>;
  }

  // editable (upcoming)
  var players = (cand && cand.players) || [];
  var sysPlayer = (cand && cand.rating && cand.rating[0]) || null; // pinned suggestion (always shown/ringed)
  var sysId = sysPlayer && sysPlayer.id;
  var pickedIds = {}; (ratings || []).forEach(function(r){ pickedIds[r.id] = 1; });
  function listFor(kind){
    var base = kind === "rating" ? players.filter(function(p){ return !pickedIds[p.id]; }) : players;
    return q ? base.filter(function(p){ return (p.name || "").toLowerCase().indexOf(q.toLowerCase()) >= 0; }) : base;
  }
  function picker(kind, onPick){
    var fl = listFor(kind);
    return <div style={{ marginBottom: 14 }}>
      <input value={q} onChange={function(e){ setQ(e.target.value); }} placeholder="Oyuncu ara…" autoFocus
        style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: "1px solid " + COLORS.border, background: COLORS.card,
          color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT, boxSizing: "border-box", marginBottom: 6 }} />
      <div className="mo-scroll" style={{ maxHeight: 210, overflowY: "auto" }}>
        {fl.length === 0 ? <div style={{ color: COLORS.textMuted, fontSize: 12, padding: "10px 4px" }}>{cand ? "Oyuncu bulunamadı." : "Yükleniyor…"}</div>
          : fl.slice(0, 60).map(function(p){
            return <div key={p.id} onClick={function(){ onPick(p); setPickFor(null); setQ(""); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 6px", borderRadius: 10, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <PredHead photo={p.photo} size={26} />
              <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{locTeam(p.team, t)}</span>
            </div>; })}
      </div>
    </div>;
  }
  function pill(val, label, sub){
    var on = onextwo === val;
    return <button onClick={function(){ setOnextwo(on ? null : val); }} style={{ flex: 1, padding: "9px 4px", borderRadius: 12, cursor: "pointer",
      border: "1px solid " + (on ? "transparent" : COLORS.border), background: on ? COLORS.accent : COLORS.card,
      color: on ? "#fff" : COLORS.textPrimary, fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </button>;
  }
  function addUserRating(p){ setRatings(function(prev){ return prev.length >= 3 ? prev : prev.concat([{ id: p.id, name: p.name, photo: p.photo, team: p.team, teamId: p.teamId, val: 3.0 }]); }); }
  function removeRating(i){ setRatings(function(prev){ return prev.filter(function(_, xi){ return xi !== i; }); }); }
  // tap a player on the pitch -> open the rating editor (a focused "player detail"-like sheet)
  var existingRating = function(id){ return (ratings || []).find(function(x){ return String(x.id) === String(id); }); };
  function openRatingEditor(p){
    var ex = existingRating(p.id);
    var isSys = sysId != null && String(p.id) === String(sysId);
    if (!ex && !isSys) { // 2 user picks max (the system suggestion is the optional 3rd)
      var nonSys = (ratings || []).filter(function(x){ return String(x.id) !== String(sysId); }).length;
      if (nonSys >= 2) return;
    }
    setRatingEdit(p); setEditVal(ex ? ex.val : 3.0);
  }
  function applyRating(p, v){
    setRatings(function(prev){
      var idx = prev.findIndex(function(x){ return String(x.id) === String(p.id); });
      if (idx >= 0) return prev.map(function(x, xi){ return xi === idx ? Object.assign({}, x, { val: v }) : x; });
      if (prev.length >= 3) return prev;
      return prev.concat([{ id: p.id, name: p.name, photo: p.photo, team: p.team, teamId: p.teamId, val: v }]);
    });
  }
  function removeRatingById(id){ setRatings(function(prev){ return prev.filter(function(x){ return String(x.id) !== String(id); }); }); }
  return <div style={{ marginBottom: 16 }}>{head}
    <div style={box}>
      {/* 1X2 */}
      <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 7 }}>Maç sonucu</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {pill("1", "1", locTeam(match.home, t))}
        {pill("X", "X", "Beraberlik")}
        {pill("2", "2", locTeam(match.away, t))}
      </div>
      {/* MOTM */}
      <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 7 }}>Maçın adamı <span style={{ color: COLORS.accent }}>+10</span></div>
      <button onClick={function(){ setPickFor(pickFor === "motm" ? null : "motm"); setQ(""); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
        borderRadius: 12, border: "1px solid " + COLORS.border, background: COLORS.card, cursor: "pointer", fontFamily: FONT, marginBottom: pickFor === "motm" ? 8 : 14, WebkitTapHighlightColor: "transparent" }}>
        {motm
          ? <><PredHead photo={motm.photo} size={26} /><span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{motm.name}</span></>
          : <span style={{ color: COLORS.textMuted, fontSize: 13 }}>Maçın en iyi oyuncusunu seç…</span>}
        <span style={{ marginLeft: "auto", color: COLORS.textMuted }}>▾</span>
      </button>
      {pickFor === "motm" && picker("motm", function(p){ setMotm(p); })}
      {/* rating picks: 2 user-chosen (tap on the pitch) + 1 system suggestion */}
      <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 3 }}>Oyuncu reytingleri <span style={{ color: COLORS.accent }}>+5</span></div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 600, marginBottom: 9 }}>{cand && cand.lineups ? "Sahadan 2 oyuncu seç, 1'ini sistem önerir · maç sonu reytingini tahmin et" : "2 oyuncuyu sen seç, 1'ini sistem önerir · maç sonu reytingini tahmin et"}</div>
      {cand && cand.lineups
        ? (function(){
            var side = cand.lineups[pside] || { starting: [] };
            var clickMap = {}; (side.starting || []).forEach(function(pl){ clickMap[pl.id] = pl; });
            var sideTeamId = pside === "home" ? match.homeId : match.awayId;
            var badgeMap = {}, ringMap = {};
            (ratings || []).forEach(function(r){ if (String(r.teamId) === String(sideTeamId)) badgeMap[r.id] = r.val; });
            // the system's suggested player is ALWAYS ringed on its side (even if not rated)
            if (sysPlayer && String(sysPlayer.teamId) === String(sideTeamId)) ringMap[sysPlayer.id] = true;
            var sysRated = sysId != null ? existingRating(sysId) : null;
            return <div style={{ marginBottom: 10 }}>
              {/* system's suggested star, pinned above the pitch — stays even if you remove its rating */}
              {sysPlayer && <div onClick={function(){ openRatingEditor(sysPlayer); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 10,
                borderRadius: 12, border: "2px solid " + COLORS.accent, background: COLORS.glassPurple, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <PredHead photo={sysPlayer.photo} size={30} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sysPlayer.name}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: COLORS.accent, padding: "1px 6px", borderRadius: 5 }}>Sistem</span>
                  </div>
                  <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{locTeam(sysPlayer.team, t)}</div>
                </div>
                {sysRated
                  ? <span style={{ marginLeft: "auto", color: COLORS.accent, fontSize: 15, fontWeight: 800 }}>{sysRated.val.toFixed(1)}</span>
                  : <span style={{ marginLeft: "auto", color: COLORS.accent, fontSize: 12, fontWeight: 700 }}>Oy ver →</span>}
              </div>}
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[{ id: "home", label: locTeam(match.home, t) }, { id: "away", label: locTeam(match.away, t) }].map(function(sd){
                  var a = pside === sd.id;
                  return <button key={sd.id} onClick={function(){ setPside(sd.id); }} style={{ flex: 1, minWidth: 0, padding: "7px 8px", borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                    border: "1px solid " + (a ? COLORS.accent + "66" : COLORS.border), background: a ? COLORS.accentDim : COLORS.card, color: a ? COLORS.accent : COLORS.textSecondary,
                    fontSize: 12, fontWeight: a ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", WebkitTapHighlightColor: "transparent" }}>{sd.label}</button>; })}
              </div>
              <Pitch lineup={side} flip={true} label={pside === "home" ? locTeam(match.home, t) : locTeam(match.away, t)} color={null}
                players={clickMap} ratings={badgeMap} highlight={ringMap} onPlayerClick={function(pl){ openRatingEditor(pl); }} />
              <div style={{ color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 6 }}>Reyting vermek için oyuncuya dokun</div>
              {/* picks summary — appears once you've rated players (tap a row to edit) */}
              {(ratings || []).length > 0 && <div style={{ marginTop: 12 }}>
                {(ratings || []).map(function(r){
                  return <div key={r.id} onClick={function(){ openRatingEditor(r); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px",
                    borderBottom: "1px solid " + COLORS.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    <PredHead photo={r.photo} size={26} />
                    <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                    {sysId != null && String(r.id) === String(sysId) && <span style={{ fontSize: 9, fontWeight: 800, color: COLORS.accent, background: COLORS.accentDim, padding: "1px 6px", borderRadius: 5 }}>Sistem</span>}
                    <span style={{ marginLeft: "auto", color: COLORS.accent, fontSize: 14, fontWeight: 800 }}>{r.val.toFixed(1)}</span>
                    <button onClick={function(e){ e.stopPropagation(); removeRatingById(r.id); }} aria-label="kaldır" style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 2 }}>×</button>
                  </div>; })}
              </div>}
            </div>;
          })()
        : <>
            {(ratings || []).map(function(r, i){
              return <div key={r.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <PredHead photo={r.photo} size={24} />
                  <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  {r.system && <span style={{ fontSize: 9, fontWeight: 800, color: COLORS.accent, background: COLORS.accentDim, padding: "1px 6px", borderRadius: 5 }}>Sistem</span>}
                  <span style={{ marginLeft: "auto", color: COLORS.accent, fontSize: 14, fontWeight: 800 }}>{r.val.toFixed(1)}</span>
                  <button onClick={function(){ removeRating(i); }} aria-label="kaldır" style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 2 }}>×</button>
                </div>
                <RatingSlider value={r.val} onChange={function(v){ setRatings(function(prev){ return prev.map(function(x, xi){ return xi === i ? Object.assign({}, x, { val: v }) : x; }); }); }} />
              </div>; })}
            {ratings.length < 3 && (pickFor === "rating"
              ? picker("rating", function(p){ addUserRating(p); })
              : <button onClick={function(){ setPickFor("rating"); setQ(""); }} style={{ width: "100%", padding: "9px 12px", borderRadius: 12, border: "1px dashed " + COLORS.border,
                  background: "transparent", color: COLORS.textSecondary, cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700, marginBottom: 14, WebkitTapHighlightColor: "transparent" }}>+ Oyuncu ekle</button>)}
          </>}
      <button onClick={save} disabled={saving} style={{ width: "100%", marginTop: 4, padding: "11px 16px", borderRadius: 12, border: "none",
        background: saved ? COLORS.cardAlt : COLORS.accent, color: saved ? COLORS.accent : "#fff",
        fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
        {saved ? "✓ Kaydedildi" : (mine ? "Kuponu Güncelle" : "Kuponu Kaydet")}</button>
    </div>
    {ratingEdit && <PredRatingSheet player={ratingEdit} initial={editVal} existing={!!existingRating(ratingEdit.id)} t={t}
      onSave={function(v){ applyRating(ratingEdit, v); }}
      onRemove={function(){ removeRatingById(ratingEdit.id); }}
      onClose={function(){ setRatingEdit(null); }} />}
  </div>;
}

// small round player head with graceful fallback (prediction coupon)
function PredHead({ photo, size }) {
  var s = size || 26;
  return photo
    ? <img src={photo} alt="" style={{ width: s, height: s, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: COLORS.cardAlt }} />
    : <span style={{ width: s, height: s, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0, display: "inline-block" }} />;
}

// read-only summary of a saved coupon (locked view)
function CouponSummary({ picks, match, t }) {
  var [actual, setActual] = useState(null);
  useEffect(function(){
    if (match.status !== "finished" || !match.id) return;
    var cancelled = false;
    fetch("/api/football?mode=matchactual&fixture=" + match.id).then(function(r){ return r.json(); })
      .then(function(j){ if (!cancelled && j && j.ready) setActual(j); }).catch(function(){});
    return function(){ cancelled = true; };
  }, [match.id, match.status]);
  if (!picks) return null;

  var GREEN = "#2FAE55";
  function ratingPts(pred, act){ if (act == null) return null; var d = Math.abs(Number(pred) - act); return d <= 0.2 ? 5 : d <= 0.5 ? 3 : d <= 1.0 ? 1 : 0; }
  var oneCorrect = (actual && actual.onextwo && picks.onextwo) ? (picks.onextwo === actual.onextwo) : null;
  var motmCorrect = (actual && picks.motm && actual.motm) ? (String(picks.motm.id) === String(actual.motm.id)) : null;
  var secLabel = { color: COLORS.textSecondary, fontSize: 11, fontWeight: 800, letterSpacing: "-0.01em" };
  var colHead = { color: COLORS.textMuted, fontSize: 10, fontWeight: 700 };
  function pts(v, on){ return <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: (on && v > 0) ? GREEN : COLORS.textMuted }}>{on ? "+" + v : ""}</span>; }

  // one 1X2 box: purple thick border = our pick, green fill = the actual result
  function resultBox(v){
    var picked = picks.onextwo === v;
    var isActual = actual && actual.onextwo === v;
    return <div key={v} style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: 11, fontWeight: 800, fontSize: 16,
      border: picked ? "2.5px solid " + COLORS.accent : "1px solid " + COLORS.border,
      background: isActual ? "rgba(47,174,85,0.18)" : COLORS.card,
      color: isActual ? GREEN : COLORS.textPrimary }}>{v}</div>;
  }
  var twoCard = { flex: 1, minWidth: 0, background: COLORS.card, borderRadius: 11, padding: "9px 12px", border: "1px solid " + COLORS.border };

  return <div>
    {/* MAÇ SONUCU — 1 / X / 2 boxes */}
    {picks.onextwo && <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={secLabel}>Maç Sonucu</span>{pts(oneCorrect ? 3 : 0, actual && actual.onextwo != null)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>{["1", "X", "2"].map(resultBox)}</div>
    </div>}

    {/* MAÇIN ADAMI — Senin / Gerçek */}
    {picks.motm && <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={secLabel}>Maçın Adamı</span>{pts(motmCorrect ? 10 : 0, actual && actual.motm != null)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={twoCard}><div style={colHead}>Senin</div>
          <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lastName(picks.motm.name)}</div></div>
        <div style={twoCard}><div style={colHead}>Gerçek</div>
          <div style={{ color: motmCorrect ? GREEN : COLORS.textPrimary, fontSize: 14, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{actual && actual.motm ? lastName(actual.motm.name) : "—"}</div></div>
      </div>
    </div>}

    {/* REYTİNGLER — table: Senin | Gerçek | Puan */}
    {picks.ratings && picks.ratings.length > 0 && <div>
      <div style={Object.assign({ marginBottom: 6 }, secLabel)}>Reytingler</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4 }}>
        <span style={{ flex: 1 }} />
        <span style={Object.assign({ width: 46, textAlign: "center" }, colHead)}>Senin</span>
        <span style={Object.assign({ width: 46, textAlign: "center" }, colHead)}>Gerçek</span>
        <span style={Object.assign({ width: 34, textAlign: "right" }, colHead)}>Puan</span>
      </div>
      {picks.ratings.map(function(r, i){
        var act = (actual && actual.ratings) ? actual.ratings[String(r.id)] : null;
        var p = ratingPts(r.pred, act);
        return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid " + COLORS.border }}>
          <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          <span style={{ width: 46, textAlign: "center", color: COLORS.accent, fontWeight: 800, fontSize: 13 }}>{Number(r.pred).toFixed(1)}</span>
          <span style={{ width: 46, display: "flex", justifyContent: "center" }}>{act != null ? <RatingBadge rating={act} /> : <span style={{ color: COLORS.textMuted, fontSize: 12 }}>—</span>}</span>
          <span style={{ width: 34, textAlign: "right", fontSize: 12, fontWeight: 800, color: (p && p > 0) ? GREEN : COLORS.textMuted }}>{p != null ? "+" + p : "—"}</span>
        </div>;
      })}
    </div>}
  </div>;
}

// Post-match consensus: how the user's player ratings compare to the community average.
// "Sen 8.5 verdin, topluluk 6.2 — kim haklı?" — a cheap, identity-flavored re-open hook.
function RatingConsensus({ match, t }) {
  var fav = useFavorites();
  var [rows, setRows] = useState(null);
  useEffect(function(){
    if (match.status !== "finished" || !match.id || !fav.loggedIn) { setRows([]); return; }
    var cancelled = false;
    Promise.all([fetchMyMatchRatings(match.id), fetchRatingConsensus(match.id)]).then(function(res){
      if (cancelled) return;
      var mine = res[0] || {}, comm = res[1] || {};
      var list = Object.keys(mine).map(function(id){
        var c = comm[id]; var avg = c ? c.avg : null;
        return { id: id, name: mine[id].name || "?", yours: mine[id].rating, avg: avg, cnt: c ? c.cnt : 0, diff: avg != null ? Math.abs(mine[id].rating - avg) : 0 };
      }).filter(function(x){ return x.avg != null; });
      list.sort(function(a, b){ return b.diff - a.diff; });
      setRows(list);
    }).catch(function(){ if (!cancelled) setRows([]); });
    return function(){ cancelled = true; };
  }, [match.id, fav.loggedIn]);
  if (!rows || rows.length === 0) return null;
  var top = rows[0];
  return <div style={{ marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ color: COLORS.accent, display: "flex" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20v-4M18 20V8"/><circle cx="12" cy="6" r="2"/></svg>
      </span>
      <span style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, letterSpacing: "-0.01em" }}>Rating Konsensüsü</span>
    </div>
    <div style={{ background: COLORS.glassPurple, border: "1px solid " + COLORS.glassBorder, borderRadius: 16, padding: "14px 16px" }}>
      <div style={{ color: COLORS.textPrimary, fontSize: 13.5, lineHeight: 1.55, marginBottom: 12 }}>
        <b>{lastName(top.name)}</b>'e sen <b style={{ color: COLORS.accent }}>{top.yours.toFixed(1)}</b> verdin, topluluk <b>{top.avg.toFixed(1)}</b>. Kim haklı?
      </div>
      {rows.slice(0, 5).map(function(r){
        var higher = r.yours >= r.avg;
        return <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid " + COLORS.border }}>
          <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          <span style={{ color: COLORS.accent, fontSize: 13, fontWeight: 800, minWidth: 30, textAlign: "right" }}>{r.yours.toFixed(1)}</span>
          <span style={{ color: COLORS.textMuted, fontSize: 11 }}>sen</span>
          <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700, minWidth: 30, textAlign: "right" }}>{r.avg.toFixed(1)}</span>
          <span style={{ color: COLORS.textMuted, fontSize: 11 }}>topluluk</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: higher ? "#2FAE55" : COLORS.red, minWidth: 34, textAlign: "right" }}>{higher ? "+" : "−"}{r.diff.toFixed(1)}</span>
        </div>; })}
    </div>
  </div>;
}

function MatchDetail({ match, isF1, t, sharedDetail, sharedLoading, jumpComments }) {
  // match.stats may be a thin snapshot (opened from the community feed) — default the array fields so nothing crashes.
  var s = Object.assign({ channels: [], homeSquad: [], awaySquad: [], homeForm: [], awayForm: [], h2h: [] }, match.stats || {});
  var [tab, setTab] = useState((isF1 || match.status === "finished") ? "info" : "tahmin"); // upcoming/live football opens on the prediction tab
  useEffect(function(){ if (jumpComments) setTab("comments"); }, [jumpComments]);
  var [h2h, setH2h] = useState(s.h2h);
  var [h2hList, setH2hList] = useState([]);
  var [h2hLoading, setH2hLoading] = useState(false);
  var [standings, setStandings] = useState(null); // { home:{form,rank,points}, away:{...} }
  var [aiText, setAiText] = useState(null);
  var [aiLoading, setAiLoading] = useState(false);
  var [aiErr, setAiErr] = useState(null);
  var [stLoading, setStLoading] = useState(false);
  var [scorers, setScorers] = useState(null);
  var [scLoading, setScLoading] = useState(false);
  var [recent, setRecent] = useState(null);
  var [rcLoading, setRcLoading] = useState(false);
  var [ownDetail, setOwnDetail] = useState(null);
  var [ownLoading, setOwnLoading] = useState(false);
  // prefer detail fetched once by the modal; fall back to own fetch
  var detail = (sharedDetail !== undefined && sharedDetail !== null) ? sharedDetail : ownDetail;
  var setDetail = setOwnDetail;
  var dtLoading = (sharedDetail !== undefined) ? sharedLoading : ownLoading;
  var setDtLoading = setOwnLoading;
  var [weather, setWeather] = useState(null);
  var [pStat, setPStat] = useState(null); // selected pitch player -> per-match stat sheet
  var [squadSide, setSquadSide] = useState("home"); // squads: show one team at a time

  // lazy: standings groups for the info tab
  useEffect(function(){
    if (tab !== "info" || standings || isF1 || !match.leagueId) return;
    setStLoading(true);
    fetch("/api/football?mode=standings&league=" + match.leagueId + "&season=" + (match.season || 2025))
      .then(function(r){ return r.json(); })
      .then(function(j){ setStandings((j.standings && j.standings.groups) ? j.standings.groups : []); })
      .catch(function(){ setStandings([]); })
      .finally(function(){ setStLoading(false); });
  }, [tab]);

  // lazy: H2H
  useEffect(function(){
    if (tab !== "h2h" || h2h.total > 0 || !match.homeId || !match.awayId) return;
    setH2hLoading(true);
    fetch("/api/football?mode=h2h&home=" + match.homeId + "&away=" + match.awayId)
      .then(function(r){ return r.json(); })
      .then(function(j){ if (j.h2h) setH2h(j.h2h); if (j.list) setH2hList(j.list); }).catch(function(){})
      .finally(function(){ setH2hLoading(false); });
  }, [tab]);

  // auto-show an already-cached AI preview on open — but only for the user who generated it
  useEffect(function(){
    if (isF1 || match.status === "finished" || !match.id || !aiSeen(match.id)) return;
    var cancelled = false;
    fetch("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matchId: match.id, peek: true }) })
      .then(function(r){ return r.json(); })
      .then(function(j){ if (!cancelled && j && j.text) setAiText(j.text); })
      .catch(function(){});
    return function(){ cancelled = true; };
  }, []);

  // lazy: scorers
  useEffect(function(){
    if (tab !== "scorers" || scorers || !match.leagueId) return;
    setScLoading(true);
    fetch("/api/football?mode=scorers&league=" + match.leagueId + "&season=" + (match.season || 2025))
      .then(function(r){ return r.json(); })
      .then(function(j){ setScorers(j.scorers || []); }).catch(function(){ setScorers([]); })
      .finally(function(){ setScLoading(false); });
  }, [tab]);

  // lazy: last-5 matches with scores
  useEffect(function(){
    if (tab !== "info" || recent || isF1 || !match.homeId) return;
    setRcLoading(true);
    fetch("/api/football?mode=recent&home=" + match.homeId + "&away=" + (match.awayId || ""))
      .then(function(r){ return r.json(); })
      .then(function(j){ setRecent(j.recent || { home: [], away: [] }); })
      .catch(function(){ setRecent({ home: [], away: [] }); })
      .finally(function(){ setRcLoading(false); });
  }, [tab]);

  // lazy: match detail (lineups + statistics) for squads/stats tabs
  useEffect(function(){
    if (sharedDetail !== undefined) return; // modal provides detail
    if ((tab !== "squads" && tab !== "matchstats" && tab !== "summary") || detail || isF1 || !match.id) return;
    setDtLoading(true);
    fetch("/api/football?mode=detail&match=" + match.id +
      "&league=" + (match.leagueId || "") + "&season=" + (match.season || 2025) +
      "&home=" + (match.homeId || "") + "&away=" + (match.awayId || ""))
      .then(function(r){ return r.json(); })
      .then(function(j){ setDetail(j.detail || { lineups: null, stats: null, subs: [], timeline: [], injuries: [], season: null, playerStats: { home: [], away: [] } }); })
      .catch(function(){ setDetail({ lineups: null, stats: null, subs: [], timeline: [], injuries: [], season: null, playerStats: { home: [], away: [] } }); })
      .finally(function(){ setDtLoading(false); });
  }, [tab]);

  // lazy: weather for the venue city (info tab)
  useEffect(function(){
    if (tab !== "info" || weather !== null || isF1) return;
    var city = s.city;
    if (!city || city === "—") { setWeather({ none: true }); return; }
    fetch("/api/football?mode=weather&city=" + encodeURIComponent(city))
      .then(function(r){ return r.json(); })
      .then(function(j){ setWeather(j.weather || { none: true }); })
      .catch(function(){ setWeather({ none: true }); });
  }, [tab]);

  // groups (array) that contain either team; usually one shared group
  var stGroups = Array.isArray(standings) ? standings : [];
  // AI pre-match preview: gather the loaded context (standings + form + H2H) and ask /api/preview
  function loadPreview() {
    if (aiLoading) return;
    setAiLoading(true); setAiErr(null);
    var h2hP = (h2h && h2h.total != null && h2h.total > 0) ? Promise.resolve(h2h)
      : (match.homeId && match.awayId
          ? fetch("/api/football?mode=h2h&home=" + match.homeId + "&away=" + match.awayId).then(function(r){ return r.json(); }).then(function(j){ return j.h2h || null; }).catch(function(){ return null; })
          : Promise.resolve(null));
    h2hP.then(function(hh){
      function rowFor(id){
        for (var g = 0; g < stGroups.length; g++) {
          var rows = stGroups[g].rows || [];
          for (var i = 0; i < rows.length; i++) {
            var rw = rows[i];
            if (String(rw.teamId) === String(id)) return { team: locTeam(rw.team, t), rank: i + 1, played: rw.played,
              win: rw.win, draw: rw.draw, lose: rw.lose, gd: rw.gd, points: rw.points };
          }
        }
        return null;
      }
      var standRows = [rowFor(match.homeId), rowFor(match.awayId)].filter(Boolean);
      var recentH2H = (h2hList || []).slice(0, 5).map(function(x){ return x.home + " " + x.score + " " + x.away + (x.date ? " (" + x.date + ")" : ""); });
      var season = (detail && detail.season && (detail.season.home || detail.season.away)) ? { home: detail.season.home, away: detail.season.away } : null;
      var ctx = { matchId: match.id, status: match.status, home: locTeam(match.home, t), away: locTeam(match.away, t),
        league: match.league, date: match.date, standings: standRows, season: season, recentH2H: recentH2H,
        homeForm: Array.isArray(s.homeForm) ? s.homeForm : null, awayForm: Array.isArray(s.awayForm) ? s.awayForm : null,
        h2h: (hh && hh.total != null) ? hh : null };
      return fetch("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ctx) }).then(function(r){ return r.json(); });
    }).then(function(j){
      if (j && j.text) { setAiText(j.text); aiMarkSeen(match.id); }
      else setAiErr(j && j.error === "no_key" ? "AI henüz ayarlı değil." : "Analiz oluşturulamadı.");
    }).catch(function(){ setAiErr("Analiz oluşturulamadı."); }).finally(function(){ setAiLoading(false); });
  }
  var myGroups = (function(){
    var containing = stGroups.filter(function(gr){
      return gr.rows && gr.rows.some(function(rw){ return rw.teamId === match.homeId || rw.teamId === match.awayId; });
    });
    var both = containing.filter(function(gr){
      var hasH = gr.rows.some(function(rw){ return rw.teamId === match.homeId; });
      var hasA = gr.rows.some(function(rw){ return rw.teamId === match.awayId; });
      return hasH && hasA;
    });
    if (both.length > 0) { both.sort(function(a,b){ return a.rows.length - b.rows.length; }); return [both[0]]; }
    // teams in different groups (e.g. World Cup knockout) -> show each team's group
    var hGroup = containing.filter(function(gr){ return gr.rows.some(function(rw){ return rw.teamId === match.homeId; }); })[0];
    var aGroup = containing.filter(function(gr){ return gr.rows.some(function(rw){ return rw.teamId === match.awayId; }); })[0];
    var out = [];
    if (hGroup) out.push(hGroup);
    if (aGroup && aGroup !== hGroup) out.push(aGroup);
    if (out.length > 0) return out;
    if (stGroups.length === 1) return stGroups;
    return [];
  })();

  var hasTimeline = detail && detail.timeline && detail.timeline.length > 0;
  var showSummary = !isF1 && (match.status === "finished" || match.status === "live");

  var tabs = [];
  if (!isF1) tabs.push({ id: "tahmin", label: "Tahmin" });
  tabs.push({ id: "info", label: t.info });
  if (showSummary) tabs.push({ id: "summary", label: t.summary });
  if (isF1 && s.homeSquad.length > 0) tabs.push({ id: "grid", label: t.grid });
  if (!isF1) tabs.push({ id: "squads", label: t.squads });
  if (!isF1) tabs.push({ id: "matchstats", label: t.matchStats });
  if (!isF1) tabs.push({ id: "h2h", label: t.h2hLabel });
  if (!isF1) tabs.push({ id: "scorers", label: t.scorers });
  if (s.channels.length > 0) tabs.push({ id: "tv", label: t.tv });
  if (!isF1 && (match.status === "finished" || match.status === "live")) tabs.push({ id: "ratings", label: "Ratingler" });
  tabs.push({ id: "comments", label: t.comments });

  return <div style={{ background: "transparent", padding: "14px 18px 18px",
    }}>
    {!isF1 && (match.status === "finished" || match.status === "live") && <MatchLogCard match={match} lineups={detail && detail.lineups} venue={s.stadium} t={t} />}
    <div style={{ marginBottom: 12 }}>
      <UnderlineTabs indicatorColor={COLORS.accent} tabs={tabs} active={tab} onChange={setTab} />
    </div>

    {tab === "tahmin" && !isF1 && <div>
      <PredictionCoupon match={match} t={t} />
      {match.status === "finished" && <RatingConsensus match={match} t={t} />}
    </div>}

    {tab === "info" && <div>
      {!isF1 && <div>
        {stLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "10px 0" }}>{t.loading}</div>}

        {myGroups.length > 0 && <CascadeItem index={0}><div style={{ marginBottom: 16 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.standing}</div>
          {myGroups.map(function(gr, gi){
            return <div key={gi} style={{ marginBottom: 12, background: COLORS.card, borderRadius: 12,
              border: "none", overflow: "hidden" }}>
              {gr.name && <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, color: COLORS.textSecondary,
                background: COLORS.cardAlt, borderBottom: "1px solid " + COLORS.border }}>{gr.name}</div>}
              <div style={{ display: "flex", padding: "6px 12px", fontSize: 10, color: COLORS.textMuted, fontWeight: 700,
                borderBottom: "1px solid " + COLORS.border }}>
                <span style={{ width: 20 }}>#</span>
                <span style={{ flex: 1 }}>{t.team}</span>
                <span style={{ width: 24, textAlign: "center" }}>{t.played}</span>
                <span style={{ width: 28, textAlign: "center" }}>{t.gd}</span>
                <span style={{ width: 26, textAlign: "center" }}>{t.points}</span>
              </div>
              {gr.rows.map(function(rw, ri){
                var mine = String(rw.teamId) === String(match.homeId) || String(rw.teamId) === String(match.awayId)
                  || rw.team === match.home || rw.team === match.away;
                return <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 12px", fontSize: 12,
                  background: mine ? COLORS.accentDim : "transparent",
                  borderBottom: ri < gr.rows.length - 1 ? "1px solid " + COLORS.border : "none" }}>
                  <span style={{ width: 20, color: COLORS.textMuted, fontWeight: 700 }}>{ri + 1}</span>
                  <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    {rw.logo && <img src={rw.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
                    <span style={{ color: COLORS.textPrimary, fontWeight: mine ? 700 : 500,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(rw.team, t)}</span>
                  </span>
                  <span style={{ width: 24, textAlign: "center", color: COLORS.textSecondary }}>{rw.played != null ? rw.played : "-"}</span>
                  <span style={{ width: 28, textAlign: "center", color: COLORS.textSecondary }}>{rw.gd != null ? (rw.gd > 0 ? "+" + rw.gd : rw.gd) : "-"}</span>
                  <span style={{ width: 26, textAlign: "center", color: COLORS.textPrimary, fontWeight: 800 }}>{rw.points != null ? rw.points : "-"}</span>
                </div>; })}
            </div>; })}
        </div></CascadeItem>}

        {(rcLoading || (recent && (recent.home.length > 0 || recent.away.length > 0))) && <CascadeItem index={1}><div style={{ marginBottom: 16 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 10, fontWeight: 700 }}>{t.last5}</div>
          {rcLoading && <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "8px 0" }}>{t.loading}</div>}
          {recent && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[{ team: match.home, list: recent.home }, { team: match.away, list: recent.away }].map(function(blk, bi){
              return <div key={bi} style={{ minWidth: 0 }}>
                <div style={{ color: COLORS.textSecondary, fontSize: 11, fontWeight: 700, marginBottom: 8,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(blk.team, t)}</div>
                {(!blk.list || blk.list.length === 0) ? <div style={{ color: COLORS.textMuted, fontSize: 11 }}>—</div>
                 : blk.list.map(function(m, i){
                    var c = m.result === "W" ? COLORS.purple : (m.result === "L" ? "#FF0000" : "#F8DE22");
                    return <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 0", minWidth: 0 }}>
                      <span style={{ flexShrink: 0, minWidth: 42, textAlign: "center", padding: "4px 7px", borderRadius: 7,
                        background: c, color: "#fff", fontSize: 12, fontWeight: 800 }}>{m.score}</span>
                      <span style={{ flex: 1, color: COLORS.textSecondary, fontSize: 11, fontWeight: 600,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{locTeam(m.opp, t)}</span>
                    </div>; })}
              </div>; })}
          </div>}
        </div></CascadeItem>}
      </div>}

      {isF1 && s.homeForm.length > 0 && <div style={{ marginBottom: 16 }}>
        <div style={{ color: COLORS.textSecondary, fontSize: 12, marginBottom: 8, fontWeight: 700 }}>{t.last5}</div>
        <div>{s.homeForm.map(function(r, i){ return <span key={i} style={{ display: "inline-block",
          background: COLORS.accentDim, color: COLORS.accent, fontWeight: 700, fontSize: 11, padding: "4px 9px",
          borderRadius: 8, marginRight: 6 }}>{r}</span>; })}</div></div>}

      {/* venue / match info at the bottom */}
      <CascadeItem index={2}><div style={{ marginTop: 4 }}>
        <StatRow label={t.referee} value={s.referee} />
        <StatRow label={t.stadium} value={s.stadium} />
        <StatRow label={t.city} value={s.city} />
        {weather && !weather.none && weather.temp != null &&
          <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid " + COLORS.border }}>
            <span style={{ color: COLORS.textSecondary, fontSize: 13 }}>{t.weather}</span>
            <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{weather.temp}°C · {wxLabel(weather.code, t)}</span>
          </div>}
        {match.matchday && <StatRow label={t.matchday} value={match.matchday + ". " + t.week} />}
      </div></CascadeItem>
    </div>}

    {tab === "grid" && <div>
      {s.homeSquad.map(function(p, i){ return <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0",
        borderBottom: "1px solid " + COLORS.border }}>
        <span style={{ color: COLORS.accent, fontWeight: 700, fontSize: 12, width: 30 }}>P{i+1}</span>
        <span style={{ color: COLORS.textPrimary, fontSize: 13 }}>{p}</span></div>; })}
    </div>}

    {tab === "h2h" && <div>
      {h2hLoading ? <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>
       : h2h.total === 0 ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noH2h}</div>
       : <>
        <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center", marginBottom: 18 }}>
          {[{ l: match.home, v: h2h.homeWins, c: COLORS.accent }, { l: t.draw, v: h2h.draws, c: COLORS.yellow },
            { l: match.away, v: h2h.awayWins, c: COLORS.red }].map(function(x, i){
            return <div key={i}><div style={{ fontSize: 30, fontWeight: 800, color: x.c }}>{x.v}</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3 }}>{x.l}</div></div>; })}
        </div>
        <div style={{ height: 5, borderRadius: 3, background: COLORS.card, overflow: "hidden", display: "flex" }}>
          <div style={{ width: (h2h.homeWins/h2h.total*100)+"%", background: COLORS.accent }} />
          <div style={{ width: (h2h.draws/h2h.total*100)+"%", background: COLORS.yellow }} />
          <div style={{ width: (h2h.awayWins/h2h.total*100)+"%", background: COLORS.red }} /></div>
        <div style={{ color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 9 }}>{h2h.total} {t.totalMatches}</div>
        {h2hList && h2hList.length > 0 && <div style={{ marginTop: 18 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.pastMatches}</div>
          {h2hList.map(function(m, i){
            return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px",
              marginBottom: 5, background: COLORS.card, borderRadius: 10, border: "none" }}>
              <span style={{ color: COLORS.textMuted, fontSize: 10, width: 64, flexShrink: 0 }}>{m.date}</span>
              <span style={{ color: COLORS.textPrimary, fontSize: 12, flex: 1, textAlign: "right",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.home}</span>
              <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 800, padding: "2px 8px",
                background: COLORS.accentDim, borderRadius: 7, flexShrink: 0 }}>{m.score}</span>
              <span style={{ color: COLORS.textPrimary, fontSize: 12, flex: 1,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.away}</span>
            </div>; })}
        </div>}
       </>}
    </div>}

    {tab === "scorers" && <div>
      {scLoading ? <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>
       : (!scorers || scorers.length === 0) ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>—</div>
       : scorers.map(function(sc, i){ return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", marginBottom: 6, background: COLORS.card, borderRadius: 12, border: "none" }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: COLORS.accentDim, color: COLORS.accent,
            fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i+1}</span>
          {sc.photo ? <img src={sc.photo} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : <span style={{ width: 30, height: 30, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.name}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{sc.team}</div></div>
          <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800, flexShrink: 0 }}>{sc.goals}</span>
        </div>; })}
    </div>}

    {tab === "tv" && <div>{s.channels.map(function(ch, i){ return <div key={i} style={{ display: "flex", alignItems: "center",
      gap: 12, padding: "11px 14px", marginBottom: 7, background: COLORS.card, borderRadius: 14, border: "none" }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: COLORS.accentDim, display: "flex",
        alignItems: "center", justifyContent: "center", color: COLORS.accent, fontSize: 12, fontWeight: 700 }}>TV</div>
      <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700 }}>{ch}</span></div>; })}</div>}

    {tab === "squads" && <div>
      {dtLoading ? <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>
       : (!detail || !detail.lineups || (detail.lineups.home.starting.length === 0 && detail.lineups.away.starting.length === 0))
         ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.lineupSoon}</div>
       : (function(){
          var subs = detail.subs || [];
          function outMap(teamId){ var m = {}; subs.forEach(function(s){ if (s.teamId === teamId && s.outId != null) m[s.outId] = true; }); return m; }
          function teamSubs(teamId){ return subs.filter(function(s){ return s.teamId === teamId; }); }
          var homeTeamId = detail.lineups.home.teamId;
          var awayTeamId = detail.lineups.away.teamId;
          // jersey colors: team color, default white if missing
          var cols = detail.colors || {};
          var homeJersey = cols.home || "#ffffff";
          var awayJersey = cols.away || "#ffffff";
          // player id -> match rating + full per-match stats (finished/live games); empty for upcoming
          var ps = detail.playerStats || { home: [], away: [] };
          var ratingById = {};
          var playerById = {};
          (ps.home || []).concat(ps.away || []).forEach(function(p){ if (p.id != null) { if (p.rating != null) ratingById[p.id] = p.rating; playerById[p.id] = p; } });
          // goals & assists per player id (from the events timeline) -> ball/boot icons on the pitch
          var goalsById = {}, assistsById = {};
          (detail.timeline || []).forEach(function(ev){
            if (ev.type === "goal" && ev.detail !== "Missed Penalty" && ev.detail !== "Own Goal") {
              if (ev.playerId != null) goalsById[ev.playerId] = (goalsById[ev.playerId] || 0) + 1;
              if (ev.assistId != null) assistsById[ev.assistId] = (assistsById[ev.assistId] || 0) + 1;
            }
          });

          return <div>
            {/* home/away toggle (home left, away right) -> one full-width pitch at a time */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[{ id: "home", label: locTeam(match.home, t) }, { id: "away", label: locTeam(match.away, t) }].map(function(sd){
                var a = squadSide === sd.id;
                return <button key={sd.id} onClick={function(){ setSquadSide(sd.id); }} style={{ flex: 1, minWidth: 0, padding: "9px 10px",
                  border: "1px solid " + (a ? COLORS.accent + "66" : COLORS.border), borderRadius: 12, cursor: "pointer", fontFamily: FONT,
                  background: a ? COLORS.accentDim : COLORS.card, color: a ? COLORS.accent : COLORS.textSecondary,
                  fontSize: 13, fontWeight: a ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  transition: "all 0.2s", WebkitTapHighlightColor: "transparent" }}>{sd.label}</button>; })}
            </div>
            <CascadeItem index={0}>
              {squadSide === "home"
                ? <Pitch lineup={detail.lineups.home} subbedOut={outMap(homeTeamId)} flip={true} label={locTeam(match.home, t)} color={homeJersey} ratings={ratingById} players={playerById} goals={goalsById} assists={assistsById} onPlayerClick={setPStat} />
                : <Pitch lineup={detail.lineups.away} subbedOut={outMap(awayTeamId)} flip={true} label={locTeam(match.away, t)} color={awayJersey} ratings={ratingById} players={playerById} goals={goalsById} assists={assistsById} onPlayerClick={setPStat} />}
            </CascadeItem>

            {/* substitutions + bench — follow the selected team (same side as the pitch toggle) */}
            <CascadeItem index={1}>{(function(){
              var blk = squadSide === "home"
                ? { lu: detail.lineups.home, sb: teamSubs(homeTeamId) }
                : { lu: detail.lineups.away, sb: teamSubs(awayTeamId) };
              return <div style={{ marginTop: 16 }}>
                {blk.sb.length > 0 && <div style={{ marginBottom: 12 }}>
                  <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>{t.substitutions}</div>
                  {blk.sb.map(function(s, i){
                    return <div key={i} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid " + COLORS.border }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ color: COLORS.accent, fontSize: 11 }}>↑</span>
                        <span style={{ color: COLORS.textPrimary, flex: 1 }}>{s.inName}</span>
                        {s.minute != null && <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{s.minute}'</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ color: COLORS.red, fontSize: 11 }}>↓</span>
                        <span style={{ color: COLORS.textSecondary, flex: 1 }}>{s.outName}</span>
                      </div>
                    </div>; })}
                </div>}
                {blk.lu.bench && blk.lu.bench.length > 0 && <div>
                  <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase" }}>{t.bench}</div>
                  {blk.lu.bench.map(function(p, i){
                    return <div key={i} style={{ color: COLORS.textSecondary, fontSize: 11, padding: "3px 0", display: "flex", gap: 7, alignItems: "center" }}>
                      <span style={{ color: COLORS.textMuted, fontSize: 10, width: 18, textAlign: "right", flexShrink: 0 }}>{p.shirt != null ? p.shirt : ""}</span>
                      <span style={{ flex: "0 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                      <GoalAssistIcons g={goalsById[p.id]} a={assistsById[p.id]} style={{ color: COLORS.textSecondary }} />
                      {ratingById[p.id] != null && <RatingBadge rating={ratingById[p.id]} style={{ minWidth: 0, padding: "0px 4px", fontSize: 10 }} />}</div>; })}
                </div>}
              </div>;
            })()}</CascadeItem>

            {detail.injuries && detail.injuries.length > 0 && <CascadeItem index={2}>
              <div style={{ marginTop: 16 }}>
                <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.injuries}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {[{ id: homeTeamId, name: match.home }, { id: awayTeamId, name: match.away }].map(function(tm, ti){
                    var list = detail.injuries.filter(function(x){ return x.teamId === tm.id; });
                    if (list.length === 0) return <div key={ti} />;
                    return <div key={ti}>
                      <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{locTeam(tm.name, t)}</div>
                      {list.map(function(x, i){
                        var susp = (x.reason || "").toLowerCase().indexOf("suspend") >= 0;
                        return <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0",
                          borderBottom: "1px solid " + COLORS.border }}>
                          <span style={{ width: 9, height: 12, borderRadius: 2, flexShrink: 0,
                            background: susp ? COLORS.red : COLORS.yellow }} />
                          <span style={{ color: COLORS.textPrimary, fontSize: 12, flex: 1 }}>{x.player}</span>
                          <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{susp ? t.suspended : t.injured}</span>
                        </div>; })}
                    </div>; })}
                </div>
              </div>
            </CascadeItem>}
          </div>;
        })()}
    </div>}

    {tab === "matchstats" && <div>
      {dtLoading ? <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>
       : (!detail || !detail.stats || (!detail.stats.home && !detail.stats.away))
         ? (detail && detail.season && (detail.season.home || detail.season.away)
            ? <SeasonStats season={detail.season} home={locTeam(match.home, t)} away={locTeam(match.away, t)} t={t} />
            : <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noMatchStats}</div>)
       : (function(){
          var labels = [
            ["Ball Possession", t.possession],
            ["Total Shots", t.shots],
            ["Shots on Goal", t.shotsOn],
            ["Shots off Goal", t.shotsOff],
            ["Blocked Shots", t.blockedShots],
            ["Corner Kicks", t.corners],
            ["Fouls", t.fouls],
            ["Offsides", t.offsides],
            ["Goalkeeper Saves", t.saves],
            ["Total passes", t.totalPasses],
            ["Passes accurate", t.accuratePasses],
            ["Yellow Cards", t.yellowCards],
            ["Red Cards", t.redCards],
          ];
          var h = detail.stats.home || {};
          var a = detail.stats.away || {};
          // ── color resolution ──
          // white/missing -> site green; if both end up same/too close -> opponent becomes red
          var cc = detail.colors || {};
          function rgb(hex){ var x=(hex||"").replace("#",""); return [parseInt(x.substring(0,2),16), parseInt(x.substring(2,4),16), parseInt(x.substring(4,6),16)]; }
          function isWhitish(hex){ if(!hex) return true; var c=rgb(hex); if(isNaN(c[0])) return true; return (0.299*c[0]+0.587*c[1]+0.114*c[2]) > 225; }
          function dist(h1,h2){ var a1=rgb(h1), b1=rgb(h2); if(isNaN(a1[0])||isNaN(b1[0])) return 999; return Math.sqrt(Math.pow(a1[0]-b1[0],2)+Math.pow(a1[1]-b1[1],2)+Math.pow(a1[2]-b1[2],2)); }
          var leftColor = isWhitish(cc.home) ? COLORS.accent : cc.home;
          var rightColor = isWhitish(cc.away) ? COLORS.accent : cc.away;
          if (dist(leftColor, rightColor) < 60) {  // too similar (e.g. both green) -> opponent red
            rightColor = COLORS.red;
            if (dist(leftColor, rightColor) < 60) leftColor = COLORS.accent;
          }
          function num(v){ if (v == null) return 0; if (typeof v === "number") return v; var n = parseFloat(String(v).replace("%","")); return isNaN(n) ? 0 : n; }
          function disp(v){ return v == null ? "0" : String(v); }
          var rows = labels.filter(function(l){ return h[l[0]] != null || a[l[0]] != null; });
          if (rows.length === 0) return <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noMatchStats}</div>;
          return <div>
            {rows.map(function(l, i){
              var hv = num(h[l[0]]); var av = num(a[l[0]]);
              var tot = (hv + av) || 1;
              return <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{disp(h[l[0]])}</span>
                  <span style={{ color: COLORS.textSecondary, fontSize: 11 }}>{l[1]}</span>
                  <span style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{disp(a[l[0]])}</span>
                </div>
                <StatBar leftPct={hv/tot*100} rightPct={av/tot*100} delay={i*60} leftColor={leftColor} rightColor={rightColor} />
              </div>; })}
          </div>;
        })()}
    </div>}

    {tab === "summary" && <div>
      {dtLoading ? <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>
       : !hasTimeline ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>{t.noEvents}</div>
       : <div style={{ position: "relative" }}>
          {/* center vertical line */}
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: COLORS.border, transform: "translateX(-50%)" }} />
          {detail.timeline.map(function(ev, i){
            return <TimelineRow key={i} ev={ev} t={t} />;
          })}
        </div>}
    </div>}

    {tab === "ratings" && <MatchRatingsTab match={match} t={t} />}

    {tab === "comments" && <CommentSection match={match} t={t} />}

    {pStat && <PlayerMatchSheet player={pStat} matchId={match.id} matchName={locTeam(match.home, t) + " - " + locTeam(match.away, t)} match={match} t={t} onClose={function(){ setPStat(null); }} />}
  </div>;
}

// Left-side auto-rotating featured box: cycles the first matches with a fade + left slide.
function FeaturedCarousel({ matches, isF1, t, onOpen }) {
  var [idx, setIdx] = useState(0);
  var [anim, setAnim] = useState(false);
  var [dir, setDir] = useState(1);
  var count = matches.length;
  var pauseRef = useRef(0); // timestamp; auto-rotate pauses for 5s after a manual nav

  function go(nextDir) {
    if (count <= 1) return;
    setDir(nextDir);
    setAnim(true);
    setTimeout(function(){
      setIdx(function(i){ return (i + nextDir + count) % count; });
      setAnim(false);
    }, 280);
  }
  function manualGo(nextDir) { pauseRef.current = Date.now(); go(nextDir); }

  useEffect(function(){
    if (count <= 1) return;
    var id = setInterval(function(){
      if (Date.now() - pauseRef.current < 5000) return; // hold after a manual click
      go(1);
    }, 2000);
    return function(){ clearInterval(id); };
  }, [count]);

  if (count === 0) return null;
  var m = matches[Math.min(idx, count - 1)];
  var isLive = m.status === "live";
  var showScore = m.score && (isLive || m.status === "finished");

  var navBtn = function(onClick, left){
    return <button onClick={function(e){ e.stopPropagation(); onClick(); }} aria-label={left ? "prev" : "next"}
      style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: left ? 10 : "auto", right: left ? "auto" : 10,
        width: 32, height: 32, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.85)",
        cursor: "pointer", color: COLORS.textPrimary, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center",
        justifyContent: "center", zIndex: 3, boxShadow: "0 2px 8px rgba(20,40,40,0.12)", WebkitTapHighlightColor: "transparent" }}>
      {left ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>}</button>;
  };

  return <div>
    <div style={{ position: "relative", overflow: "hidden",
      background: "linear-gradient(160deg, " + COLORS.card + ", " + COLORS.cardAlt + ")",
      borderRadius: 26, border: "none",
      boxShadow: "0 8px 30px rgba(20,40,40,0.08)", minHeight: 420 }}>

      {count > 1 && navBtn(function(){ manualGo(-1); }, true)}
      {count > 1 && navBtn(function(){ manualGo(1); }, false)}

      <div onClick={function(){ onOpen(m); }} style={{ cursor: "pointer", padding: "26px 46px 22px",
        minHeight: 420, display: "flex", flexDirection: "column",
        opacity: anim ? 0 : 1, transform: anim ? "translateX(" + (dir * -22) + "px)" : "translateX(0)",
        transition: "opacity 0.32s cubic-bezier(0.22,1,0.36,1), transform 0.32s cubic-bezier(0.22,1,0.36,1)" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary }}>{m.league}</span>
          {isLive ? <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.red, background: COLORS.red + "18",
            padding: "3px 10px", borderRadius: 7, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.5s infinite", display: "inline-block" }} />
            {t.live}{m.minute ? " " + m.minute + "'" : ""}</span>
          : <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textMuted }}>{m.date ? m.date + " · " : ""}{m.time}</span>}
        </div>

        {isF1 ? <div style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: 800, textAlign: "center", marginTop: 30 }}>{m.home}</div>
        : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 16 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 0 }}>
              <TeamLogo src={m.homeLogo} name={locTeam(m.home, t)} size={62} />
              <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700, textAlign: "center",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{locTeam(m.home, t)}</span>
            </div>
            <div style={{ flexShrink: 0, textAlign: "center" }}>
              {showScore ? <div style={{ color: COLORS.accent, fontSize: 34, fontWeight: 800 }}>{m.score}</div>
               : <div style={{ color: COLORS.textSecondary, fontSize: 24, fontWeight: 800 }}>{m.time}</div>}
              {!showScore && <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 4 }}>VS</div>}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 0 }}>
              <TeamLogo src={m.awayLogo} name={locTeam(m.away, t)} size={62} />
              <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700, textAlign: "center",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{locTeam(m.away, t)}</span>
            </div>
          </div>}

        {/* quick 1X2 prediction — predict straight from the carousel */}
        {!isF1 && m.status === "upcoming" && <div style={{ marginTop: 22 }}>
          <div style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 800, textAlign: "center", marginBottom: 8, letterSpacing: "-0.01em" }}>Tahminin</div>
          <Quick1x2 match={m} layout="below" />
        </div>}

        {/* dots */}
        {count > 1 && <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 26 }}>
          {matches.map(function(_, i){
            return <span key={i} style={{ width: i === idx ? 18 : 6, height: 6, borderRadius: 3,
              background: i === idx ? COLORS.accent : COLORS.border,
              transition: "width 0.3s ease, background 0.3s ease" }} />; })}
        </div>}

        {/* details pinned to the very bottom */}
        <div style={{ marginTop: "auto", paddingTop: 22, textAlign: "center" }}>
          <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, color: COLORS.accent,
            background: COLORS.accentDim, padding: "9px 20px", borderRadius: 12 }}>{t.viewDetails}</span>
        </div>
      </div>
    </div>
  </div>;
}

// Rotating major-stats box: top scorers <-> top assists for a league.
function MajorStats({ leagueId, season, t }) {
  var [scorers, setScorers] = useState(null);
  var [assists, setAssists] = useState(null);
  var [view, setView] = useState(0); // 0 = scorers, 1 = assists
  var [anim, setAnim] = useState(false);

  useEffect(function(){
    setScorers(null); setAssists(null);
    fetch("/api/football?mode=scorers&league=" + leagueId + "&season=" + season)
      .then(function(r){ return r.json(); }).then(function(j){ setScorers(j.scorers || []); }).catch(function(){ setScorers([]); });
    fetch("/api/football?mode=assists&league=" + leagueId + "&season=" + season)
      .then(function(r){ return r.json(); }).then(function(j){ setAssists(j.assists || []); }).catch(function(){ setAssists([]); });
  }, [leagueId, season]);

  useEffect(function(){
    var id = setInterval(function(){
      setAnim(true);
      setTimeout(function(){ setView(function(v){ return v === 0 ? 1 : 0; }); setAnim(false); }, 280);
    }, 5000);
    return function(){ clearInterval(id); };
  }, []);

  var isScorers = view === 0;
  var list = (isScorers ? scorers : assists) || [];
  if ((scorers === null && assists === null)) return null;
  if (list.length === 0) return null;

  function flip(d) {
    setAnim(true);
    setTimeout(function(){ setView(function(v){ return v === 0 ? 1 : 0; }); setAnim(false); }, 280);
  }
  var arrowBtn = function(onClick, left){
    return <button onClick={onClick} aria-label={left ? "prev" : "next"} style={{ width: 26, height: 26, borderRadius: 8,
      border: "none", background: COLORS.cardAlt, cursor: "pointer", color: COLORS.textPrimary,
      fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
      WebkitTapHighlightColor: "transparent" }}>{left
        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>}</button>;
  };

  return <div style={{ marginTop: 16, background: COLORS.card, borderRadius: 18, border: "none", padding: "16px 18px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: COLORS.textPrimary }}>{isScorers ? t.topScorers : t.topAssists}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {[0,1].map(function(v){ return <span key={v} style={{ width: v === view ? 16 : 6, height: 6, borderRadius: 3,
            background: v === view ? COLORS.accent : COLORS.border, transition: "width 0.3s ease, background 0.3s ease" }} />; })}
        </div>
        {arrowBtn(function(){ flip(-1); }, true)}
        {arrowBtn(function(){ flip(1); }, false)}
      </div>
    </div>
    <div style={{ opacity: anim ? 0 : 1, transform: anim ? "translateY(8px)" : "translateY(0)",
      transition: "opacity 0.3s ease, transform 0.3s ease" }}>
      {list.slice(0, 5).map(function(p, i){
        var val = isScorers ? p.goals : p.assists;
        return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
          borderBottom: i < 4 ? "1px solid " + COLORS.border : "none" }}>
          <span style={{ width: 18, color: COLORS.textMuted, fontSize: 12, fontWeight: 700, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
          {p.photo ? <img src={p.photo} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : <span style={{ width: 26, height: 26, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 600,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
              {p.teamLogo && <img src={p.teamLogo} alt="" style={{ width: 12, height: 12, objectFit: "contain" }} />}
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(p.team, t)}</span></div>
          </div>
          <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 800, flexShrink: 0 }}>{val}</span>
        </div>; })}
    </div>
  </div>;
}

// Flashscore-style country -> league tree shown in the left column for the active sport.
function LeagueTree({ groups, loading, t, selectedId, onSelect }) {
  var [openCountry, setOpenCountry] = useState(null); // single-open accordion (null = first group open)
  if (!loading && (!groups || groups.length === 0)) return null;
  return <div style={{ background: COLORS.card, borderRadius: 22, border: "1px solid " + COLORS.border,
    marginBottom: 16, overflow: "hidden",
    animation: "moDrop 0.34s cubic-bezier(0.22,1,0.36,1) both" }}>
    <div style={{ padding: "13px 16px", fontSize: 13, fontWeight: 800, color: COLORS.textPrimary,
      borderBottom: "1px solid " + COLORS.border }}>{t.leaguesTitle}</div>
    {loading
      ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "18px 0" }}>{t.loading}</div>
      : <div className="mo-scroll" style={{ maxHeight: 380, overflowY: "auto" }}>
          {groups.map(function(g, gi){
            var isOpen = openCountry === null ? (gi === 0) : (openCountry === g.country);
            return <div key={gi} style={{ borderBottom: "1px solid " + COLORS.border }}>
              <button onClick={function(){ setOpenCountry(isOpen ? "" : g.country); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", border: "none",
                  background: "transparent", cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
                {g.flag ? <img src={g.flag} alt="" style={{ width: 18, height: 13, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />
                  : <span style={{ width: 18, height: 13, borderRadius: 2, background: COLORS.cardAlt, flexShrink: 0 }} />}
                <span style={{ flex: 1, textAlign: "left", color: COLORS.textPrimary, fontSize: 13, fontWeight: 600,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.country}</span>
                <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{g.leagues.length}</span>
                <span style={{ color: COLORS.textMuted, fontSize: 14, transform: isOpen ? "rotate(90deg)" : "none",
                  transition: "transform 0.2s ease", display: "inline-block" }}>›</span>
              </button>
              {isOpen && <div style={{ paddingBottom: 4, animation: "moDrop 0.26s cubic-bezier(0.22,1,0.36,1) both" }}>
                {g.leagues.map(function(l){
                  var sel = selectedId === l.id;
                  return <button key={l.id} onClick={function(){ onSelect(l); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 14px 8px 30px", border: "none",
                      background: sel ? COLORS.accentDim : "transparent", cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
                    {leagueLogo(l.id, l.logo) ? <img src={leagueLogo(l.id, l.logo)} onError={logoFallback(l.logo)} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />
                      : <span style={{ width: 16, height: 16, borderRadius: 4, background: COLORS.cardAlt, flexShrink: 0 }} />}
                    <span style={{ flex: 1, textAlign: "left", color: sel ? COLORS.accent : COLORS.textSecondary, fontSize: 12,
                      fontWeight: sel ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                  </button>; })}
              </div>}
            </div>; })}
        </div>}
  </div>;
}

// World Cup uses a custom local logo (wc_logo.png in /public); everyone else uses the api-sports logo.
// Dark-mode white logo overrides for leagues whose official logo is dark/black (invisible on black).
// Drop the PNGs in /public; until then the <img> onError falls back to the api-sports logo.
var LEAGUE_LOGO_WHITE = { 39: "/pl-white.PNG", 2: "/ucl-white.PNG", 3: "/uel-white.PNG", 848: "/conf-white.png",
  204: "/trendyol-1-white.png", 205: "/nesine-2-white.png", 552: "/nesine-3-white.png", // Turkey 1./2./3. Lig (dark)
  79: "/germany-2-white.png", 80: "/germany-3-white.png", 82: "/germany-4-white.png", // Germany 2./3./Frauen (dark)
  435: "/spain-4-white.png", // Spain Primera RFEF (dark)
  88: "/netherlands-1-white.png" }; // Eredivisie (dark)
function leagueLogo(id, fallback) {
  if (String(id) === "1") return "/wc_logo.png";
  if (String(id) === "61") return "/ligue-1.png"; // custom Ligue 1 logo
  if (String(id) === "71") return CURRENT_THEME === "dark" ? "/brasil-1-white.png" : "/brasil-1-black.png"; // Brazil Serie A per-theme
  if (String(id) === "72") return "/brasil-2.png"; // Brazil Serie B (both themes)
  if (String(id) === "74") return CURRENT_THEME === "dark" ? "/brasil-3-white.png" : "/brasil-3-black.png"; // Brazil Women per-theme
  if (String(id) === "89") return "/netherlands-2.png"; // Eerste Divisie (both themes)
  if (String(id) === "144") return "/belgium-1.png"; // Jupiler Pro League (both themes)
  if (String(id) === "254") return "/usa-2.png"; // NWSL Women (both themes)
  if (String(id) === "78") return CURRENT_THEME === "dark" ? "/bundesliga-white.png" : "/bundesliga-black.png"; // Bundesliga per-theme
  if (String(id) === "203") return CURRENT_THEME === "dark" ? "/superlig-white.png" : "/superlig-black.png"; // Süper Lig per-theme
  if (CURRENT_THEME === "dark" && LEAGUE_LOGO_WHITE[id]) return LEAGUE_LOGO_WHITE[id];
  return fallback || null;
}
// onError handler: if a white-override file is missing, fall back to the original api-sports logo once.
function logoFallback(orig) {
  return function(e){ if (e.currentTarget.src.indexOf(orig) === -1) { e.currentTarget.onerror = null; e.currentTarget.src = orig; } };
}

// Per-league tube-light glow color (by api-sports league id). Unlisted leagues fall back to the logo's own color.
var LEAGUE_GLOW = {
  1: "#F4A11C",                               // World Cup — yellow-orange
  2: "#1F6FEB",                               // Champions League — blue
  3: "#F26A1B",                               // Europa League — orange
  848: "#1FAE55",                             // Conference — green
  39: "#8A2BE2",                              // Premier League — purple
  40: "#E2231A", 41: "#E2231A", 42: "#E2231A",// England rest — red
  140: "#E2231A",                             // La Liga — red
  141: "#16C0C0",                             // Segunda — turquoise
  142: "#1FAE55",                             // Primera Femenina — green
  435: "#FF3B0F",                             // Primera RFEF G1 — flame red
  78: "#E2231A", 79: "#E2231A",               // Bundesliga 1-2 — red
  80: "#1FAE55", 82: "#1FAE55",               // German 3rd-4th — green
  135: "#16C0C0",                             // Serie A — turquoise
  136: "#1FAE55",                             // Serie B — green
  138: "#E2231A",                             // Serie C — red
  139: "#16C0C0",                             // Serie A Women — turquoise
  61: "#3FA9F5", 62: "#3FA9F5", 63: "#3FA9F5", 64: "#3FA9F5",       // France all — light blue
  203: "#E2231A", 204: "#E2231A", 205: "#E2231A", 552: "#E2231A",   // Turkey all — red
};

// Pull a representative color out of a logo image (skips transparent/white/black pixels). Falls back to null.
function useImageColor(src) {
  var [color, setColor] = useState(null);
  useEffect(function(){
    setColor(null);
    if (!src || typeof window === "undefined") return;
    var cancelled = false;
    var img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = function(){
      try {
        var c = document.createElement("canvas"); var w = c.width = 24, h = c.height = 24;
        var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
        var d = ctx.getImageData(0, 0, w, h).data;
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) {
          if (d[i+3] < 128) continue;
          var rr = d[i], gg = d[i+1], bb = d[i+2];
          var mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
          if (mx > 235 && mn > 235) continue; // near-white
          if (mx < 32) continue;              // near-black
          r += rr; g += gg; b += bb; n++;
        }
        if (!cancelled && n > 0) setColor("rgb(" + Math.round(r/n) + "," + Math.round(g/n) + "," + Math.round(b/n) + ")");
      } catch (e) {}
    };
    img.src = src;
    return function(){ cancelled = true; };
  }, [src]);
  return color;
}

// Right-column league detail: big logo + fixtures, past matches, standings, top scorers.
function LeagueDetailPanel({ league, matches, matchesLoading, t, onOpenMatch, onClear }) {
  var [standings, setStandings] = useState(null);
  var [scorers, setScorers] = useState(null);
  var [tab, setTab] = useState("standing"); // default section = standings
  var curSeason = league.season || 2025;
  var [season, setSeason] = useState(curSeason); // selectable: past seasons (immutable -> cached cheaply)
  var groupRefs = useRef({}); // standings group sections (for filter -> smooth scroll)
  // World Cup -> current only; European cups -> last 2 seasons; domestic leagues -> last 5
  var EURO_CUPS = { 2: true, 3: true, 848: true }; // CL / UEL / Conference
  var seasonOpts = [];
  var nSeasons = league.id === 1 ? 1 : (EURO_CUPS[league.id] ? 2 : 5); // 1 = World Cup (no past seasons)
  for (var si = 0; si < nSeasons; si++) seasonOpts.push(curSeason - si);

  // scorers + season reset follow the league
  useEffect(function(){
    setSeason(curSeason);
    var cancelled = false;
    setScorers(null);
    if (league.sport === "football") {
      fetch("/api/football?mode=scorers&league=" + league.id + "&season=" + curSeason)
        .then(function(r){ return r.json(); })
        .then(function(j){ if (!cancelled) setScorers(j.scorers || []); })
        .catch(function(){ if (!cancelled) setScorers([]); });
    } else { setScorers([]); }
    return function(){ cancelled = true; };
  }, [league.id]);

  // standings follow the season selector
  useEffect(function(){
    var cancelled = false;
    setStandings(null);
    if (league.sport === "football") {
      fetch("/api/football?mode=standings&league=" + league.id + "&season=" + season)
        .then(function(r){ return r.json(); })
        .then(function(j){ if (!cancelled) setStandings((j.standings && j.standings.groups) ? j.standings.groups : []); })
        .catch(function(){ if (!cancelled) setStandings([]); });
    } else { setStandings([]); }
    return function(){ cancelled = true; };
  }, [league.id, season]);

  // banner logo + tube-light color for the league header
  var bannerLogo = leagueLogo(league.id, league.logo);
  var bannerCol = useImageColor(bannerLogo);
  var glow = LEAGUE_GLOW[league.id] || bannerCol || COLORS.accent;

  var upcoming = (matches || []).filter(function(m){ return m.status === "upcoming" || m.status === "live"; });
  var allPast = (matches || []).filter(function(m){ return m.status === "finished"; });
  // past matches shown depend on the competition:
  //  - European cups (CL/UEL/Conf): only the knockout rounds (quarters/semis/final)
  //  - World Cup: all recent results
  //  - domestic leagues: only the last completed matchday (round)
  var EURO_CUP = { 2: true, 3: true, 848: true };
  var past;
  if (EURO_CUP[league.id]) {
    var ko = allPast.filter(function(m){ return (m.round || "").toLowerCase().indexOf("final") >= 0; }); // quarter-/semi-finals + final
    past = ko.length ? ko : allPast;
  } else if (String(league.id) === "1") {
    past = allPast;
  } else {
    var latest = null;
    allPast.forEach(function(m){ if (m.ts != null && (!latest || m.ts > latest.ts)) latest = m; });
    var lastRound = latest && latest.round;
    past = lastRound ? allPast.filter(function(m){ return m.round === lastRound; }) : allPast;
  }
  var group0 = (standings && standings.length) ? standings[0] : null;
  var box = { background: COLORS.card, borderRadius: 18, border: "1px solid " + COLORS.border, padding: 8 };
  // date-grouped match list with day separators (like the main feed); ascending=true -> soonest day first
  function groupedList(list, ascending){
    var todayKey = isoLocal(new Date());
    function header(k){ return k === todayKey ? t.todayLabel : (k.slice(8, 10) + "." + k.slice(5, 7) + "." + k.slice(0, 4)); }
    var groups = {};
    list.forEach(function(m){ var k = m.dateKey || todayKey; if (!groups[k]) groups[k] = []; groups[k].push(m); });
    var keys = Object.keys(groups).sort(function(a, b){ return ascending ? (a < b ? -1 : a > b ? 1 : 0) : (a < b ? 1 : a > b ? -1 : 0); });
    return <div className="mo-scroll" style={Object.assign({}, box, { maxHeight: "62vh", overflowY: "auto", padding: "2px 10px 8px" })}>
      {keys.map(function(k){
        var items = groups[k].slice().sort(function(a, b){ return ascending ? ((a.ts || 0) - (b.ts || 0)) : ((b.ts || 0) - (a.ts || 0)); });
        return <div key={k} style={{ marginBottom: 4 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, padding: "14px 4px 8px",
            borderBottom: "1px solid " + COLORS.border, marginBottom: 2 }}>{header(k)}</div>
          {items.map(function(m, i){ return <MatchRow key={m.id} match={m} isF1={false} t={t} divider={i < items.length - 1} onOpen={function(){ onOpenMatch(m); }} />; })}
        </div>;
      })}
    </div>;
  }

  return <div style={{ minWidth: 0, animation: "moFade 0.26s ease both" }}>
    {/* full-bleed banner: logo + name + section tabs; league-color tube-light fills it and fades downward to the tabs (no box) */}
    <div style={{ position: "relative", overflow: "hidden", borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: "18px 16px 14px", marginBottom: 8, animation: "moDrop 0.34s cubic-bezier(0.22,1,0.36,1) both" }}>
      {/* soft tube-light: a blurred glow source up top, diffusing down — fully fades (transparent) before the
          bottom edge so overflow:hidden never clips a hard line */}
      <span aria-hidden style={{ position: "absolute", left: -30, right: -30, top: -36, bottom: 0, pointerEvents: "none", opacity: 0.62,
        filter: "blur(34px)", WebkitFilter: "blur(34px)",
        background: "linear-gradient(180deg, " + glow + " 0%, " + glow + " 14%, transparent 58%)" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        {bannerLogo ? <img src={bannerLogo} onError={logoFallback(league.logo)} alt="" style={{ width: 58, height: 58, objectFit: "contain", flexShrink: 0 }} />
          : <span style={{ width: 58, height: 58, borderRadius: 14, background: COLORS.cardAlt, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: COLORS.textPrimary, fontSize: 21, fontWeight: 800,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{league.name}</div>
        </div>
        <button onClick={onClear} aria-label="kapat" className="mo-xbtn" style={{ width: 34, height: 34, borderRadius: 999,
          border: "1px solid " + COLORS.border, background: COLORS.card, color: COLORS.textSecondary, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      {/* section tabs: sliding-underline tab bar (always purple); sits inside the banner */}
      <UnderlineTabs baseline={false} active={tab} onChange={setTab} indicatorColor={COLORS.accent}
        tabs={[{ id: "standing", label: t.standing }, { id: "fixtures", label: t.fixturesLabel },
          { id: "past", label: t.pastMatches }, { id: "scorers", label: t.scorers }]} />
    </div>

    <SlidePanel slideKey={tab} dir={0}>
      {tab === "standing" && <div>
        {/* season dropdown: domestic leagues -> last 5, European cups -> last 2 (World Cup: none). Past seasons immutable -> cached cheaply */}
        {seasonOpts.length > 1 && <div style={{ position: "relative", display: "inline-block", marginBottom: 12 }}>
          <select value={season} onChange={function(e){ setSeason(parseInt(e.target.value, 10)); }}
            style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: FONT,
              background: COLORS.card, color: COLORS.textPrimary, border: "1px solid " + COLORS.border, borderRadius: 10,
              padding: "8px 34px 8px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer", outline: "none" }}>
            {seasonOpts.map(function(yr){ return <option key={yr} value={yr}>{fmtSeasonLabel(yr)}</option>; })}
          </select>
          <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: COLORS.textSecondary, display: "flex" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          </span>
        </div>}
        {standings && standings.length > 0
        ? <div>
            {/* group filter: tap a group to smooth-scroll to its table */}
            {standings.length > 1 && <div className="mo-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
              {standings.map(function(g, gi){
                return <button key={gi} onClick={function(){
                    var el = groupRefs.current[gi]; if (!el) return;
                    var header = document.querySelector(".mo-sticky");
                    var off = (header ? header.offsetHeight : 60) + 14;
                    var y = el.getBoundingClientRect().top + window.scrollY - off;
                    window.scrollTo({ top: y, behavior: "smooth" });
                  }}
                  className="mo-lgchip"
                  style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 10, border: "1px solid " + COLORS.border, background: "transparent",
                    color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap",
                    WebkitTapHighlightColor: "transparent" }}>{g.name || (t.standing + " " + (gi + 1))}</button>; })}
            </div>}
            {standings.map(function(g, gi){
              if (!g.rows || !g.rows.length) return null;
              return <div key={gi} ref={function(el){ groupRefs.current[gi] = el; }} style={{ marginBottom: 16, scrollMarginTop: 8 }}>
                {g.name && <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, margin: "0 0 8px", padding: "0 2px" }}>{g.name}</div>}
                <div style={{ background: COLORS.card, borderRadius: 12, border: "1px solid " + COLORS.border, overflow: "hidden" }}>
                  <div style={{ display: "flex", padding: "6px 12px", fontSize: 10, color: COLORS.textMuted, fontWeight: 700, borderBottom: "1px solid " + COLORS.border }}>
                    <span style={{ width: 20 }}>#</span><span style={{ flex: 1 }}>{t.team}</span>
                    <span style={{ width: 24, textAlign: "center" }}>{t.played}</span>
                    <span style={{ width: 28, textAlign: "center" }}>{t.gd}</span>
                    <span style={{ width: 26, textAlign: "center" }}>{t.points}</span>
                  </div>
                  {g.rows.map(function(rw, ri){
                    return <div key={ri} style={{ display: "flex", alignItems: "center", padding: "7px 12px", fontSize: 12,
                      borderBottom: ri < g.rows.length - 1 ? "1px solid " + COLORS.border : "none" }}>
                      <span style={{ width: 20, color: COLORS.textMuted, fontWeight: 700 }}>{ri + 1}</span>
                      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                        {rw.logo && <img src={rw.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
                        <span style={{ color: COLORS.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(rw.team, t)}</span>
                      </span>
                      <span style={{ width: 24, textAlign: "center", color: COLORS.textSecondary }}>{rw.played != null ? rw.played : "-"}</span>
                      <span style={{ width: 28, textAlign: "center", color: COLORS.textSecondary }}>{rw.gd != null ? (rw.gd > 0 ? "+" + rw.gd : rw.gd) : "-"}</span>
                      <span style={{ width: 26, textAlign: "center", color: COLORS.textPrimary, fontWeight: 800 }}>{rw.points != null ? rw.points : "-"}</span>
                    </div>; })}
                </div>
              </div>; })}
          </div>
        : (standings === null ? <SkeletonRows rows={8} card={false} /> : <EmptyState icon={<EmptyIcon name="ball" />} title={t.noStandings} />)}
      </div>}

      {tab === "scorers" && (scorers && scorers.length > 0
        ? <div style={box}>
            {scorers.map(function(sc, i){
              return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                borderBottom: i < scorers.length - 1 ? "1px solid " + COLORS.border : "none" }}>
                <span style={{ width: 22, color: COLORS.textMuted, fontSize: 12, fontWeight: 800, textAlign: "center" }}>{i + 1}</span>
                {sc.photo ? <img src={sc.photo} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                  : <span style={{ width: 28, height: 28, borderRadius: "50%", background: COLORS.cardAlt }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.name}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{sc.team}</div>
                </div>
                <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800 }}>{sc.goals}</span>
              </div>; })}
          </div>
        : (scorers === null ? <SkeletonRows rows={6} card={false} /> : <div style={{ textAlign: "center", padding: "26px 0", color: COLORS.textMuted, fontSize: 13 }}>—</div>))}

      {tab === "fixtures" && (matchesLoading ? <SkeletonRows rows={5} />
        : upcoming.length > 0 ? groupedList(upcoming, true)
        : <EmptyState icon={<EmptyIcon name="ball" />} title={t.noMatches} />)}

      {tab === "past" && (matchesLoading ? <SkeletonRows rows={5} />
        : past.length > 0 ? groupedList(past, false)
        : <EmptyState icon={<EmptyIcon name="ball" />} title={t.noMatches} />)}
    </SlidePanel>
  </div>;
}

// "Standouts of the day" campaign card (left column): 3 top-rated players, tap to rate them.
function StandoutsBox({ players, t, onOpen }) {
  if (!players || players.length === 0) return null;
  return <div onClick={onOpen} style={{ marginTop: 16, cursor: "pointer", borderRadius: 18,
    background: COLORS.card, padding: "14px 14px 16px", WebkitTapHighlightColor: "transparent" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.accent, flexShrink: 0 }} />
      <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 800 }}>{t.standoutsTitle}</span>
      <span style={{ marginLeft: "auto", color: COLORS.textMuted, fontSize: 16, fontWeight: 700 }}>›</span>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      {players.map(function(p, i){
        return <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", background: COLORS.cardAlt, borderRadius: 14, padding: "12px 6px 11px" }}>
          {p.photo ? <img src={p.photo} alt="" style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }} />
            : <span style={{ width: 46, height: 46, borderRadius: "50%", background: COLORS.card, display: "inline-block" }} />}
          <div style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700, marginTop: 7,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lastName(p.name)}</div>
          <div style={{ color: COLORS.textMuted, fontSize: 10, marginBottom: 8,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(p.team, t)}</div>
          <RatingBadge rating={p.rating} style={{ fontSize: 13, padding: "2px 8px", borderRadius: 7 }} />
        </div>;
      })}
    </div>
  </div>;
}

// Compact display name for tight chips: the last token of a full name.
function lastName(n){ n = (n || "").trim(); if (!n) return ""; var parts = n.split(" "); return parts.length > 1 ? parts[parts.length - 1] : n; }

// Which knockout round the "team of the round" is built from. Bump to "Round of 16" etc. as the WC advances.
var WC_TOTW_ROUND = "Round of 32";

// Team of the round: best XI (4-3-3) from every finished match of the WC's current knockout round.
// Shown on a small pitch in the sidebar; hidden until the API returns an XI.
function HaftaninTakimi({ season, t, onOpenPlayer }) {
  var [data, setData] = useState(null);
  useEffect(function(){
    var cancelled = false;
    fetch("/api/football?mode=totw&league=1&season=" + (season || 2026) + "&round=" + encodeURIComponent(WC_TOTW_ROUND))
      .then(function(r){ return r.json(); })
      .then(function(j){ if (!cancelled) setData(j || { players: [] }); })
      .catch(function(){ if (!cancelled) setData({ players: [] }); });
    return function(){ cancelled = true; };
  }, [season]);
  if (!data || !data.players || data.players.length === 0) return null;
  var rows = [["F"], ["M"], ["D"], ["G"]].map(function(g){
    return data.players.filter(function(p){ return p.slot === g[0]; });
  });
  function chip(p){
    return <div key={p.id} onClick={function(){ if (onOpenPlayer && p.id != null) onOpenPlayer({ id: p.id, name: p.name, photo: p.photo }); }}
      style={{ width: 58, textAlign: "center", cursor: onOpenPlayer ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ position: "relative", width: 42, height: 42, margin: "0 auto 3px" }}>
        {p.photo
          ? <img src={p.photo} alt="" style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.9)", background: "#0a5c30" }} />
          : <span style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "inline-block", border: "2px solid rgba(255,255,255,0.9)" }} />}
        <span style={{ position: "absolute", right: -4, bottom: -4, background: "#fff", color: "#0a5c30", fontSize: 9.5,
          fontWeight: 800, borderRadius: 6, padding: "0 4px", lineHeight: "15px", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>{p.rating != null ? p.rating.toFixed(1) : "-"}</span>
      </div>
      <div style={{ color: "#fff", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lastName(p.name)}</div>
    </div>;
  }
  return <div style={{ marginTop: 16, borderRadius: 22, overflow: "hidden", boxShadow: "0 2px 14px rgba(20,40,40,0.10)" }}>
    <div style={{ padding: "13px 15px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "linear-gradient(160deg, #12833f, #0a5c30)" }}>
      <span style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>{t.totwTitle}</span>
      <span style={{ color: "rgba(255,255,255,0.82)", fontSize: 11, fontWeight: 700 }}>{data.round}</span>
    </div>
    <div style={{ position: "relative", padding: "16px 10px", minHeight: 372,
      background: "repeating-linear-gradient(180deg, #0e7038 0 40px, #0c6a34 40px 80px)" }}>
      {/* field markings */}
      {(function(){ var ln = "rgba(255,255,255,0.24)"; var b = "2px solid " + ln;
        return <div aria-hidden style={{ position: "absolute", top: 12, left: 12, right: 12, bottom: 12, border: b, borderRadius: 6, pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, marginTop: -1, background: ln }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 76, height: 76, marginLeft: -38, marginTop: -38, border: b, borderRadius: "50%" }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 5, height: 5, marginLeft: -2.5, marginTop: -2.5, background: ln, borderRadius: "50%" }} />
          {/* top box (attacking third) */}
          <div style={{ position: "absolute", left: "50%", top: 0, width: "48%", height: 58, transform: "translateX(-50%)", borderLeft: b, borderRight: b, borderBottom: b }} />
          <div style={{ position: "absolute", left: "50%", top: 0, width: "26%", height: 26, transform: "translateX(-50%)", borderLeft: b, borderRight: b, borderBottom: b }} />
          {/* bottom box (own third) */}
          <div style={{ position: "absolute", left: "50%", bottom: 0, width: "48%", height: 58, transform: "translateX(-50%)", borderLeft: b, borderRight: b, borderTop: b }} />
          <div style={{ position: "absolute", left: "50%", bottom: 0, width: "26%", height: 26, transform: "translateX(-50%)", borderLeft: b, borderRight: b, borderTop: b }} />
        </div>;
      })()}
      {/* players spread across the pitch: rows top(F) -> bottom(G), evenly within each row */}
      <div style={{ position: "relative", zIndex: 1, minHeight: 340, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        {rows.map(function(row, ri){ return <div key={ri} style={{ display: "flex", justifyContent: "space-evenly", alignItems: "center", gap: 4 }}>
          {row.map(function(p){ return chip(p); })}
        </div>; })}
      </div>
    </div>
  </div>;
}

// ── The Match Log (the spine) ────────────────────────────────────────────────
// Style tags = "the paint": each is a labelled vote nudging the Taste Graph.
// vec: est = pragmatik(-1) ↔ estetik(+1); rol = işçi/defansif(-1) ↔ şovmen/hücum(+1).
var STYLE_TAGS = [
  { id: "savunma",  label: "Savunma dersi",        vec: { est: -0.8, rol: -0.7 } },
  { id: "golduello", label: "Gol düellosu",        vec: { est: 0.8,  rol: 0.6 } },
  { id: "ortasaha", label: "Orta saha savaşı",     vec: { est: -0.3, rol: -0.3 } },
  { id: "bireysel", label: "Bireysel sınıf",       vec: { est: 0.6,  rol: 0.7 } },
  { id: "taktik",   label: "Taktik satranç",       vec: { est: -0.6, rol: -0.1 } },
  { id: "tempo",    label: "Tempo & kaos",         vec: { est: 0.5,  rol: 0.4 } },
  { id: "karakter", label: "Karakter & dönüş",     vec: { est: 0.3,  rol: 0.1 } },
  { id: "hakem",    label: "Hakem tartışması",     vec: { est: 0.0,  rol: 0.0 } },
];
// Short verdict word for a 0-10 match rating (the match uses the same 0-10 slider as players).
function matchWord(v){
  if (v <= 0) return "İzleme keyfi";
  if (v < 4) return "Kötü maç";
  if (v < 5.5) return "Vasat";
  if (v < 6.5) return "İdare eder";
  if (v < 7.5) return "İyi maçtı";
  if (v < 8.5) return "Harikaydı";
  return "Efsane maç";
}

// The atomic post-match action: rate the watch (stars) + tag why (paint) + rate 3 players
// (≥1 from each side). Saving stamps a diary row and feeds the Taste Graph.
function MatchLogSheet({ match, lineups, venue, existing, t, onClose, onSaved, onDeleted }) {
  var [visible, setVisible] = useState(false);
  var drag = useSheetDrag(function(){ doClose(); });
  var [rating, setRating] = useState(existing && existing.rating != null ? Number(existing.rating) : 3.0);
  var [rated, setRated] = useState(!!(existing && existing.rating != null)); // must rate the match before saving
  var [attended, setAttended] = useState(!!(existing && existing.attended)); // stadium check-in vs screen
  var [photoFile, setPhotoFile] = useState(null);
  var [photoPrev, setPhotoPrev] = useState((existing && existing.photo) || null); // preview src (existing url or local blob)
  var photoInput = useRef(null);
  function onPickPhoto(e){ var f = e.target.files && e.target.files[0]; if (!f) return; setPhotoFile(f); setPhotoPrev(URL.createObjectURL(f)); }
  function clearPhoto(){ setPhotoFile(null); setPhotoPrev(null); }
  var [tags, setTags] = useState(existing && Array.isArray(existing.tags) ? existing.tags.slice() : []);
  var [sel, setSel] = useState([]);      // [{ id, name, photo, side, val }]
  var [side, setSide] = useState("home");
  var [edit, setEdit] = useState(null);  // player being rated in the pitch editor
  var [saving, setSaving] = useState(false);
  var [err, setErr] = useState(null);
  useEffect(function(){
    var id = requestAnimationFrame(function(){ setVisible(true); });
    var prev = document.body.style.overflow; document.body.style.overflow = "hidden"; // lock background scroll
    return function(){ cancelAnimationFrame(id); document.body.style.overflow = prev; };
  }, []);
  function doClose(){ setVisible(false); setTimeout(onClose, 300); }

  function toggleTag(id){ setTags(function(c){ return c.indexOf(id) >= 0 ? c.filter(function(x){ return x !== id; }) : (c.length >= 3 ? c : c.concat(id)); }); }
  function upsertPlayer(p, val){
    setSel(function(c){
      var i = c.findIndex(function(x){ return String(x.id) === String(p.id); });
      if (i >= 0) { var n = c.slice(); n[i] = Object.assign({}, n[i], { val: val }); return n; }
      if (c.length >= 3) return c;
      return c.concat({ id: p.id, name: p.name, photo: p.photo, side: p.side, pos: p.pos, val: val });
    });
  }
  function removePlayer(id){ setSel(function(c){ return c.filter(function(x){ return String(x.id) !== String(id); }); }); }
  var homeSel = sel.filter(function(p){ return p.side === "home"; }).length;
  var awaySel = sel.filter(function(p){ return p.side === "away"; }).length;
  var hasLineups = !!(lineups && ((lineups.home && lineups.home.starting && lineups.home.starting.length) || (lineups.away && lineups.away.starting && lineups.away.starting.length)));
  // players are optional; the only rule is you can't end up 3 from one team (3-0)
  function blockedThird(pl){
    if (sel.some(function(x){ return String(x.id) === String(pl.id); })) return false;
    if (sel.length >= 3) return true;
    if (sel.length === 2 && homeSel === 2 && pl.side === "home") return true;
    if (sel.length === 2 && awaySel === 2 && pl.side === "away") return true;
    return false;
  }
  function openEditor(pl){
    if (blockedThird(pl)) return;
    var ex = sel.filter(function(x){ return String(x.id) === String(pl.id); })[0];
    setEdit({ id: pl.id, name: pl.name, photo: pl.photo, side: side, pos: pl.position || null, cur: ex ? ex.val : null });
  }
  var canSave = rated && !saving; // must rate the match itself first; players optional
  function del(){
    if (saving) return; setSaving(true); setErr(null);
    deleteMatchLog(match.id).then(function(res){
      setSaving(false);
      if (res && res.error) { setErr("Silinemedi — tekrar dene."); return; }
      if (onDeleted) onDeleted();
      doClose();
    }).catch(function(){ setSaving(false); setErr("Silinemedi — tekrar dene."); });
  }

  function save(){
    if (!canSave) return; setSaving(true); setErr(null);
    var photoUrl = (attended && photoPrev && !photoFile) ? photoPrev : null; // keep existing url, unless cleared/replaced
    // upload the stadium photo first (best-effort — a failed upload never blocks the log)
    var pre = (attended && photoFile) ? uploadLogPhoto(match.id, photoFile).then(function(r){ if (r && r.url) photoUrl = r.url; }).catch(function(){})
      : Promise.resolve();
    pre.then(function(){
      // save the MATCH log — player ratings must never be orphaned without a logged match
      return saveMatchLog({ matchId: match.id, rating: rating, tags: tags, home: match.home, away: match.away,
        homeLogo: match.homeLogo, awayLogo: match.awayLogo, score: match.score,
        league: match.league, matchTs: match.ts ? new Date(match.ts).toISOString() : null,
        attended: attended, venue: venue || null, photo: photoUrl,
        players: sel.map(function(p){ return { pos: p.pos || null, rating: p.val, side: p.side }; }) });
    })
      .then(function(res){
        if (res && res.error) return Promise.reject(res.error);
        return Promise.all(sel.map(function(p){ return saveRating({ targetType: "player", targetId: p.id, matchId: match.id, targetName: p.name, sport: "football", rating: p.val }); }));
      })
      .then(function(){ setSaving(false); if (onSaved) onSaved({ rating: rating, tags: tags, attended: attended, venue: attended ? (venue || null) : null, photo: attended ? photoUrl : null }); doClose(); })
      .catch(function(){ setSaving(false); setErr("Kaydedilemedi — tekrar dene."); });
  }

  // active side's pitch data (tap a player → rating editor; selected players show a rating badge)
  var sideLu = (lineups && lineups[side]) || { starting: [] };
  var clickMap = {}; (sideLu.starting || []).forEach(function(pl){ clickMap[pl.id] = pl; });
  var badgeMap = {}; sel.forEach(function(r){ if (r.side === side) badgeMap[r.id] = r.val; });

  var head = { color: COLORS.textPrimary, fontSize: 14, fontWeight: 800, marginBottom: 10, letterSpacing: "-0.01em" };

  if (typeof document === "undefined") return null;
  // portal to <body> so position:fixed + backdrop blur cover the WHOLE viewport (the match modal uses transform)
  return createPortal(<><div onClick={doClose}
    onTouchStart={function(e){ e.stopPropagation(); }} onTouchMove={function(e){ e.stopPropagation(); }} onTouchEnd={function(e){ e.stopPropagation(); }}
    style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.42)",
    backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)",
    display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", opacity: visible ? 1 : 0, transition: "opacity 0.3s ease" }}>
    {/* match identity ABOVE the sheet, on the blurred backdrop (Letterboxd style) */}
    <div style={{ flex: 1, minHeight: 0, width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "max(24px, env(safe-area-inset-top)) 24px 18px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 6, maxWidth: "100%" }}>
        <TeamLogo src={match.homeLogo} name={match.home} size={22} />
        <span style={{ color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{locTeam(match.home, t)}</span>
        <span style={{ color: "#fff", fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0, padding: "0 2px" }}>{match.score || "-"}</span>
        <span style={{ color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{locTeam(match.away, t)}</span>
        <TeamLogo src={match.awayLogo} name={match.away} size={22} />
      </div>
      {match.date && <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 700 }}>{match.date}</div>}
    </div>
    <div onClick={function(e){ e.stopPropagation(); }}
      onTouchStart={drag.handlers.onTouchStart} onTouchMove={drag.handlers.onTouchMove} onTouchEnd={drag.handlers.onTouchEnd}
      style={{ width: "100%", maxWidth: 440, maxHeight: "74vh", overflowY: "auto", background: COLORS.card, fontFamily: FONT,
        borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: "1px solid " + COLORS.border,
        boxShadow: "0 -8px 40px rgba(20,40,40,0.28)", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain",
        transform: visible ? ("translateY(" + drag.dragY + "px)") : "translateY(100%)",
        transition: drag.dragging ? "none" : "transform 0.32s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ padding: "10px 18px 0" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 10px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em" }}>Logla</span>
          <button onClick={doClose} aria-label="kapat" className="mo-xbtn" style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid " + COLORS.border,
            background: "transparent", color: COLORS.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <div style={{ padding: "0 18px max(24px, env(safe-area-inset-bottom))" }}>
        {/* 0 — how did you watch it: at the ground (check-in) or on a screen */}
        <div style={{ display: "flex", gap: 8, marginBottom: attended ? 8 : 22 }}>
          {[{ on: false, label: "Ekrandan", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg> },
            { on: true, label: "Statta", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg> }].map(function(m){
            var a = attended === m.on;
            return <button key={String(m.on)} onClick={function(){ setAttended(m.on); }} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 8px", borderRadius: 12, cursor: "pointer", fontFamily: FONT,
              border: "1px solid " + (a ? COLORS.accent : COLORS.border), background: a ? COLORS.accentDim : "transparent", color: a ? COLORS.accent : COLORS.textSecondary,
              fontSize: 13, fontWeight: a ? 800 : 600, WebkitTapHighlightColor: "transparent" }}>{m.icon}{m.label}</button>;
          })}
        </div>
        {attended && <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.accent, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
            {venue ? venue + "'de izledin — koleksiyonuna eklenecek" : "Statta izledin — koleksiyonuna eklenecek"}</div>
          <input ref={photoInput} type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
          {photoPrev
            ? <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid " + COLORS.border }}>
                <img src={photoPrev} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", display: "block" }} />
                <button onClick={clearPhoto} aria-label="fotoğrafı kaldır" style={{ position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 999, border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
            : <button onClick={function(){ if (photoInput.current) photoInput.current.click(); }} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 12, border: "1px dashed " + COLORS.border, background: "transparent", color: COLORS.textSecondary, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                Staddan fotoğraf ekle</button>}
        </div>}
        {/* 1 — rate the match (same 0-10 slider as players) */}
        <div style={{ marginBottom: 22 }}>
          <div style={head}>Maçı puanla</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 800, minWidth: 46, color: rated ? COLORS.accent : COLORS.textMuted }}>{rating.toFixed(1)}</span>
            <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700 }}>{rated ? matchWord(rating) : "önce maçı puanla"}</span>
          </div>
          <RatingSlider value={rating} onChange={function(v){ setRating(v); setRated(true); }} />
        </div>

        {/* 2 — style tags (the paint) */}
        <div style={{ marginBottom: 22 }}>
          <div style={head}>Ne öne çıktı?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STYLE_TAGS.map(function(tg){
              var on = tags.indexOf(tg.id) >= 0, dis = !on && tags.length >= 3;
              return <button key={tg.id} onClick={function(){ toggleTag(tg.id); }} className={on ? undefined : "mo-lgchip"}
                style={{ padding: "7px 13px", borderRadius: 11, cursor: dis ? "default" : "pointer", fontFamily: FONT,
                  border: "1px solid " + (on ? COLORS.accent : COLORS.border), background: on ? COLORS.accentDim : "transparent",
                  color: on ? COLORS.accent : (dis ? COLORS.textMuted : COLORS.textSecondary), fontSize: 12.5, fontWeight: on ? 800 : 600,
                  opacity: dis ? 0.5 : 1, WebkitTapHighlightColor: "transparent" }}>{tg.label}</button>;
            })}
          </div>
        </div>

        {/* 3 — three players on the pitch (≥1 per side; tap a player to rate, like the coupon) */}
        {hasLineups && <div style={{ marginBottom: 20 }}>
          <div style={head}>Oyuncu puanla</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[{ id: "home", label: locTeam(match.home, t), n: homeSel }, { id: "away", label: locTeam(match.away, t), n: awaySel }].map(function(sd){
              var a = side === sd.id;
              return <button key={sd.id} onClick={function(){ setSide(sd.id); }} style={{ flex: 1, minWidth: 0, padding: "7px 8px", borderRadius: 10, cursor: "pointer", fontFamily: FONT,
                border: "1px solid " + (a ? COLORS.accent : COLORS.border), background: a ? COLORS.accentDim : "transparent", color: a ? COLORS.accent : COLORS.textSecondary,
                fontSize: 12, fontWeight: a ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", WebkitTapHighlightColor: "transparent" }}>{sd.label}{sd.n > 0 ? " · " + sd.n : ""}</button>;
            })}
          </div>
          <Pitch lineup={sideLu} flip={true} label={side === "home" ? locTeam(match.home, t) : locTeam(match.away, t)} color={null}
            players={clickMap} ratings={badgeMap} onPlayerClick={function(pl){ openEditor(pl); }} />
          <div style={{ color: COLORS.textMuted, fontSize: 11, textAlign: "center", marginTop: 6 }}>Puan vermek için oyuncuya dokun</div>
          {sel.length > 0 && <div style={{ marginTop: 12 }}>
            {sel.map(function(r){
              return <div key={r.id} onClick={function(){ setEdit({ id: r.id, name: r.name, photo: r.photo, side: r.side, cur: r.val }); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid " + COLORS.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <PredHead photo={r.photo} size={26} />
                <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <span style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{r.side === "home" ? locTeam(match.home, t) : locTeam(match.away, t)}</span>
                <span style={{ marginLeft: "auto", color: ratingColor(r.val), fontSize: 14, fontWeight: 800 }}>{r.val.toFixed(1)}</span>
                <button onClick={function(e){ e.stopPropagation(); removePlayer(r.id); }} aria-label="kaldır" style={{ border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 2 }}>×</button>
              </div>;
            })}
          </div>}
          {sel.length === 2 && (homeSel === 2 || awaySel === 2) && <div style={{ color: COLORS.textMuted, fontSize: 11.5, marginTop: 10 }}>
            3. oyuncuyu {homeSel === 2 ? locTeam(match.away, t) : locTeam(match.home, t)} takımından seç · 3-0 olmaz</div>}
        </div>}

        <button onClick={save} disabled={!canSave} style={{ width: "100%", marginTop: 6, padding: 14, borderRadius: 14, border: "none",
          background: canSave ? COLORS.accent : COLORS.cardAlt, color: canSave ? "#fff" : COLORS.textMuted, fontSize: 15, fontWeight: 800,
          cursor: canSave ? "pointer" : "default", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
          {saving ? "Kaydediliyor…" : "Kaydet"}</button>
        {existing && <button onClick={del} disabled={saving} style={{ width: "100%", marginTop: 10, padding: 11, borderRadius: 12,
          border: "1px solid " + COLORS.red + "55", background: "transparent", color: COLORS.red, fontSize: 13, fontWeight: 800,
          cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>Logu sil</button>}
        {err && <div style={{ color: COLORS.red, fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  </div>
  {edit && <PredRatingSheet player={{ id: edit.id, name: edit.name, photo: edit.photo }} initial={edit.cur != null ? edit.cur : 3.0} existing={edit.cur != null} t={t}
    onSave={function(v){ upsertPlayer({ id: edit.id, name: edit.name, photo: edit.photo, side: edit.side, pos: edit.pos }, v); setEdit(null); }}
    onRemove={function(){ removePlayer(edit.id); setEdit(null); }}
    onClose={function(){ setEdit(null); }} />}
  </>, document.body);
}

// Community rating distribution for a finished match: Letterboxd-style histogram.
// Desktop: hover a bar. Mobile: press-and-hold and slide left/right to read the buckets.
// Faded-purple bars (not a colour ramp). Placeholder fake distribution until real aggregates land.
function MatchRatingDist({ match, action }) {
  var [active, setActive] = useState(null);
  var barsRef = useRef(null);
  var seed = 2166136261; var s = String(match.id || (match.home + match.away) || "x");
  for (var i = 0; i < s.length; i++) { seed ^= s.charCodeAt(i); seed = (seed * 16777619) >>> 0; }
  function rnd(){ seed = (seed * 1103515245 + 12345) >>> 0; return (seed & 0x7fffffff) / 0x7fffffff; }
  var NB = 10, peak = 5.6 + rnd() * 2.8, spread = 1.15 + rnd() * 0.95, counts = [], total = 0;
  for (var b = 0; b < NB; b++) { var xc = b + 0.5; var base = Math.exp(-Math.pow(xc - peak, 2) / (2 * spread * spread)); var c = Math.round(base * (2600 + rnd() * 9000)); if (xc < 3) c = Math.round(c * 0.12); counts.push(c); total += c; }
  var maxC = counts.reduce(function(m, c){ return Math.max(m, c); }, 1);
  var wsum = 0; counts.forEach(function(c, b){ wsum += c * (b + 0.5); });
  var avg = total ? wsum / total : 0;
  var fmt = function(n){ return n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "") + "B" : String(n); };
  // light purple at rest (can't hex-append alpha to a CSS var — use color-mix), full accent when active
  var BASE = "color-mix(in srgb, " + COLORS.accent + " 62%, transparent)";
  function idxFromX(clientX){ var el = barsRef.current; if (!el) return null; var r = el.getBoundingClientRect(); var i = Math.floor((clientX - r.left) / r.width * NB); return Math.max(0, Math.min(NB - 1, i)); }
  function touchSet(e){ e.stopPropagation(); if (e.touches && e.touches[0]) setActive(idxFromX(e.touches[0].clientX)); }
  return <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em" }}>Topluluk puanı</span>
        <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: COLORS.accent }}>{avg.toFixed(1)}</span>
      </div>
      {action}
    </div>
    {/* info box — reveals on hover (desktop) / press-hold (mobile) */}
    <div style={{ minHeight: 16, marginBottom: 5 }}>
      {active != null
        ? <span style={{ fontSize: 11.5, fontWeight: 800, color: COLORS.accent }}>{active}–{active + 1} arası · {fmt(counts[active])} kişi <span style={{ color: COLORS.textMuted, fontWeight: 700 }}>(%{total ? Math.round(counts[active] / total * 100) : 0})</span></span>
        : <span style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.textMuted }}>{fmt(total)} oy</span>}
    </div>
    <div ref={barsRef} style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34, touchAction: "none" }}
      onMouseLeave={function(){ setActive(null); }}
      onTouchStart={touchSet} onTouchMove={touchSet}
      onTouchEnd={function(e){ e.stopPropagation(); setActive(null); }}>
      {counts.map(function(c, b){
        var on = active === b;
        var col = on ? COLORS.accent : BASE; // only the active bar pops; the rest keep their colour
        return <div key={b} onMouseEnter={function(){ setActive(b); }}
          style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          <div style={{ width: "100%", height: Math.max(3, c / maxC * 34), borderRadius: 3, background: col, transition: "background 0.15s ease" }} />
        </div>;
      })}
    </div>
  </div>;
}

// Post-match entry point shown at the top of a finished match: the log CTA or the user's log summary.
function MatchLogCard({ match, lineups, venue, t }) {
  var [log, setLog] = useState(undefined); // undefined = loading, null = none, obj = exists
  var [open, setOpen] = useState(false);
  var [uid, setUid] = useState(null);
  useEffect(function(){
    var c = false;
    getUserId().then(function(id){
      if (c) return;
      setUid(id || null);
      if (!id) { setLog(null); return; }
      fetchMyMatchLog(match.id).then(function(l){ if (!c) setLog(l); }).catch(function(){ if (!c) setLog(null); });
    }).catch(function(){ if (!c) setLog(null); });
    return function(){ c = true; };
  }, [match.id]);
  var tagLabel = function(id){ var f = STYLE_TAGS.filter(function(x){ return x.id === id; })[0]; return f ? f.label : id; };

  function launch(){ if (!uid) { if (FAV.onNeedLogin) FAV.onNeedLogin(); return; } setOpen(true); }

  var hasLog = log && log.rating != null;
  var action = hasLog
    ? <button onClick={launch} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
        border: "1px solid " + COLORS.accent, background: COLORS.accentDim, color: COLORS.accent, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
        Sen {Number(log.rating).toFixed(1)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      </button>
    : <button onClick={launch} style={{ flexShrink: 0, padding: "8px 15px", borderRadius: 12, border: "none", background: COLORS.accent,
        color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>Logla</button>;
  return <div style={{ marginBottom: 14, background: COLORS.card, border: "1px solid " + COLORS.border, borderRadius: 16, padding: "12px 15px" }}>
    <MatchRatingDist match={match} action={action} />
    {open && <MatchLogSheet match={match} lineups={lineups} venue={venue} existing={log} t={t}
      onClose={function(){ setOpen(false); }}
      onSaved={function(res){ setLog(Object.assign({}, log || {}, { rating: res.rating, tags: res.tags, attended: res.attended, venue: res.venue })); }}
      onDeleted={function(){ setLog(null); }} />}
  </div>;
}

// Ratings tab: everyone's match ratings for this match; tap a row for that user's full log detail.
function MatchRatingsTab({ match, t }) {
  var [logs, setLogs] = useState(null);
  var [view, setView] = useState(null);
  var [uid, setUid] = useState(null);
  useEffect(function(){
    var c = false;
    getUserId().then(function(id){ if (!c) setUid(id || null); }).catch(function(){});
    fetchMatchLogs(match.id).then(function(l){ if (!c) setLogs(l || []); }).catch(function(){ if (!c) setLogs([]); });
    return function(){ c = true; };
  }, [match.id]);
  if (logs === null) return <div style={{ padding: "12px 2px" }}><SkeletonRows rows={4} card={false} /></div>;
  if (logs.length === 0) return <EmptyState icon={<EmptyIcon name="ball" />} title="Henüz puan yok" hint="Bu maçı ilk loglayan sen ol — üstteki Logla ile." />;
  var avg = logs.reduce(function(s, l){ return s + l.rating; }, 0) / logs.length;
  return <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 12px" }}>
      <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 700 }}>{logs.length} kişi puanladı</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 700 }}>ort.</span>
        <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 800 }}>{avg.toFixed(1)}</span>
      </span>
    </div>
    {logs.map(function(l){
      var me = uid && String(l.userId) === String(uid);
      return <div key={l.userId} onClick={function(){ setView(l); }} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 8px",
        borderBottom: "1px solid " + COLORS.border, cursor: "pointer", background: me ? COLORS.accentDim : "transparent", WebkitTapHighlightColor: "transparent" }}>
        <span style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 14, fontWeight: 800 }}>{(l.user || "?")[0].toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {me ? "@" + l.user + " (sen)" : <UserLink userId={l.userId} username={l.user} t={t} style={{ color: COLORS.textPrimary, fontWeight: 700 }} />}</div>
          {l.tags && l.tags.length > 0 && <div style={{ color: COLORS.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.tags.map(function(id){ var f = STYLE_TAGS.filter(function(x){ return x.id === id; })[0]; return f ? f.label : id; }).join(" · ")}</div>}
        </div>
        <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 800, flexShrink: 0 }}>{l.rating.toFixed(1)}</span>
        <span style={{ color: COLORS.textMuted, flexShrink: 0, fontSize: 16 }}>›</span>
      </div>;
    })}
    {view && <RatingDetailSheet match={match} log={view} t={t} onClose={function(){ setView(null); }} />}
  </div>;
}

// Small bottom sheet: one user's full log — match rating (purple) + player ratings (green/yellow/red).
function RatingDetailSheet({ match, log, t, onClose, onDelete }) {
  var [visible, setVisible] = useState(false);
  var [players, setPlayers] = useState(null);
  var [deleting, setDeleting] = useState(false);
  var drag = useSheetDrag(function(){ close(); });
  useEffect(function(){
    var id = requestAnimationFrame(function(){ setVisible(true); });
    var prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    fetchUserMatchRatings(match.id, log.userId).then(function(p){ setPlayers(p || []); }).catch(function(){ setPlayers([]); });
    return function(){ cancelAnimationFrame(id); document.body.style.overflow = prev; };
  }, []);
  function close(){ setVisible(false); setTimeout(onClose, 280); }
  if (typeof document === "undefined") return null;
  return createPortal(<div onClick={close}
    onTouchStart={function(e){ e.stopPropagation(); }} onTouchMove={function(e){ e.stopPropagation(); }} onTouchEnd={function(e){ e.stopPropagation(); }}
    style={{ position: "fixed", inset: 0, zIndex: 1370, background: "rgba(0,0,0,0.42)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)",
      display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", opacity: visible ? 1 : 0, transition: "opacity 0.3s ease" }}>
    {/* match identity above the sheet, on the blurred backdrop */}
    <div style={{ flex: 1, minHeight: 0, width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "max(24px, env(safe-area-inset-top)) 24px 18px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, maxWidth: "100%" }}>
        <TeamLogo src={match.homeLogo} name={match.home} size={22} />
        <span style={{ color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>{locTeam(match.home, t)}</span>
        <span style={{ color: "#fff", fontSize: 17, fontWeight: 800, flexShrink: 0, padding: "0 2px" }}>{match.score || "-"}</span>
        <span style={{ color: "#fff", fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>{locTeam(match.away, t)}</span>
        <TeamLogo src={match.awayLogo} name={match.away} size={22} />
      </div>
    </div>
    <div onClick={function(e){ e.stopPropagation(); }}
      onTouchStart={drag.handlers.onTouchStart} onTouchMove={drag.handlers.onTouchMove} onTouchEnd={drag.handlers.onTouchEnd}
      style={{ width: "100%", maxWidth: 440, maxHeight: "72vh", overflowY: "auto", background: COLORS.card, fontFamily: FONT,
      borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: "1px solid " + COLORS.border, boxShadow: "0 -8px 40px rgba(20,40,40,0.28)",
      transform: visible ? ("translateY(" + drag.dragY + "px)") : "translateY(100%)", transition: drag.dragging ? "none" : "transform 0.32s cubic-bezier(0.22,1,0.36,1)",
      WebkitOverflowScrolling: "touch", overscrollBehavior: "contain",
      padding: "10px 18px max(24px, env(safe-area-inset-bottom))" }}>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 14px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800 }}>{log.own ? "Senin logun" : "@" + log.user}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 700 }}>maç</span>
          <span style={{ color: COLORS.accent, fontSize: 22, fontWeight: 800 }}>{log.rating.toFixed(1)}</span>
        </div>
      </div>
      {log.attended && <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.accent, fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
        {log.venue || "Statta izledi"}</div>}
      {log.photo && <img src={log.photo} alt="" style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 14, marginBottom: 14, display: "block", border: "1px solid " + COLORS.border }} />}
      {log.tags && log.tags.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {log.tags.map(function(id){ var f = STYLE_TAGS.filter(function(x){ return x.id === id; })[0]; return <span key={id} style={{ padding: "3px 9px", borderRadius: 999, background: COLORS.accentDim, color: COLORS.accent, fontSize: 11, fontWeight: 700 }}>{f ? f.label : id}</span>; })}
      </div>}
      <div style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 8 }}>Oyuncu ratingleri</div>
      {players === null
        ? <SkeletonRows rows={3} card={false} />
        : players.length === 0
          ? <div style={{ color: COLORS.textMuted, fontSize: 12.5, padding: "8px 2px" }}>Bu logda oyuncu puanı yok.</div>
          : players.map(function(p){
              return <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderBottom: "1px solid " + COLORS.border }}>
                <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <RatingBadge rating={p.rating} />
              </div>;
            })}
      {onDelete && <button onClick={function(){ if (deleting) return; setDeleting(true); Promise.resolve(onDelete()).then(function(){ close(); }).catch(function(){ setDeleting(false); }); }}
        disabled={deleting} style={{ width: "100%", marginTop: 18, padding: 11, borderRadius: 12, border: "1px solid " + COLORS.red + "55",
        background: "transparent", color: COLORS.red, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
        {deleting ? "Siliniyor…" : "Logu sil"}</button>}
    </div>
  </div>, document.body);
}

// A rich log row: crest–score–crest, the user's star rating, tags, venue + date.
function LogCard({ g, t, lang, onClick }) {
  return <div onClick={onClick} style={{ padding: "12px 14px", marginBottom: 8, background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border, cursor: onClick ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TeamLogo src={g.home_logo} name={g.home} size={20} />
      <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(g.home, t)}</span>
      <span style={{ flexShrink: 0, minWidth: 46, textAlign: "center", color: COLORS.textPrimary, fontSize: 14, fontWeight: 800 }}>{g.score || "-"}</span>
      <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(g.away, t)}</span>
      <TeamLogo src={g.away_logo} name={g.away} size={20} />
    </div>
    {g.tags && g.tags.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
      {g.tags.map(function(id){ var f = STYLE_TAGS.filter(function(x){ return x.id === id; })[0]; return <span key={id} style={{ padding: "3px 9px", borderRadius: 999, background: COLORS.accentDim, color: COLORS.accent, fontSize: 11, fontWeight: 700 }}>{f ? f.label : id}</span>; })}
    </div>}
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, background: COLORS.accentDim, color: COLORS.accent, fontSize: 12, fontWeight: 800 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.27l-5.9 3.09 1.13-6.58L2.45 9.14l6.6-.96z" /></svg>
        {Number(g.rating).toFixed(1)}</span>
      {g.attended && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: COLORS.accent, fontSize: 11, fontWeight: 700, minWidth: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{g.venue || "Statta"}</span></span>}
      <span style={{ marginLeft: "auto", flexShrink: 0, color: COLORS.textMuted, fontSize: 11, fontWeight: 600 }}>{relTime(g.created_at, lang)}</span>
    </div>
  </div>;
}

// Clickable @username → opens that user's public profile. stopPropagation so it doesn't also fire
// the row/card's own onClick (open match). No user_id → renders as plain (non-clickable) text.
function UserLink({ userId, username, t, style }) {
  var [open, setOpen] = useState(false);
  var nm = username || "kullanıcı";
  if (!userId) return <span style={style}>@{nm}</span>;
  return <>
    <span onClick={function(e){ e.stopPropagation(); setOpen(true); }} style={Object.assign({ cursor: "pointer" }, style || {})}>@{nm}</span>
    {open && <UserProfileSheet userId={userId} username={nm} t={t} onClose={function(){ setOpen(false); }} />}
  </>;
}

// Public profile of another user: their Taste Graph + logs + comments. Bottom sheet.
function UserProfileSheet({ userId, username, t, onClose }) {
  var [visible, setVisible] = useState(false);
  var [logs, setLogs] = useState(null);
  var [comments, setComments] = useState(null);
  var [tab, setTab] = useState("logs");
  var [logView, setLogView] = useState(null);
  var [avatar, setAvatar] = useState(null);
  var lang = (t && t._lang) || "tr";
  useEffect(function(){
    var id = requestAnimationFrame(function(){ setVisible(true); });
    var prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    fetchUserLogs(userId, 60).then(function(l){ setLogs(l || []); }).catch(function(){ setLogs([]); });
    fetchUserComments(userId, 40).then(function(cs){ setComments(cs || []); }).catch(function(){ setComments([]); });
    fetchUserAvatar(userId).then(function(u){ setAvatar(u || null); }).catch(function(){});
    return function(){ cancelAnimationFrame(id); document.body.style.overflow = prev; };
  }, [userId]);
  function close(){ setVisible(false); setTimeout(onClose, 280); }
  function stopP(e){ e.stopPropagation(); }
  if (typeof document === "undefined") return null;
  var initial = (username || "?")[0].toUpperCase();
  var tagLbl = function(id){ var f = STYLE_TAGS.filter(function(x){ return x.id === id; })[0]; return f ? f.label : id; };
  var box = { padding: "12px 14px", marginBottom: 8, background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border };
  return createPortal(<><div onClick={close} onTouchStart={stopP} onTouchMove={stopP} onTouchEnd={stopP}
    style={{ position: "fixed", inset: 0, zIndex: 1360, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", opacity: visible ? 1 : 0, transition: "opacity 0.3s ease" }}>
    <div onClick={stopP} style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", background: COLORS.bg, fontFamily: FONT,
      borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: "1px solid " + COLORS.border, boxShadow: "0 -8px 40px rgba(20,40,40,0.28)",
      transform: visible ? "translateY(0)" : "translateY(100%)", transition: "transform 0.32s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ padding: "10px 18px max(24px, env(safe-area-inset-bottom))" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 14px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          {avatar
            ? <img src={avatar} alt="" style={{ width: 52, height: 52, borderRadius: 18, objectFit: "cover", flexShrink: 0, display: "block" }} />
            : <div style={{ width: 52, height: 52, borderRadius: 18, flexShrink: 0, background: "linear-gradient(135deg, " + COLORS.accent + ", " + COLORS.teal + ")",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#fff" }}>{initial}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>@{username}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 700, marginTop: 2 }}>{logs === null ? "…" : logs.length} log</div>
          </div>
          <button onClick={close} aria-label="kapat" className="mo-xbtn" style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid " + COLORS.border,
            background: "transparent", color: COLORS.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 12 }}>Taste Graph</div>
          <FootballDNA t={t} userId={userId} />
        </div>
        <UnderlineTabs indicatorColor={COLORS.accent} active={tab} onChange={setTab}
          tabs={[{ id: "logs", label: "Loglar" }, { id: "comments", label: "Yorumlar" }]} />
        <div style={{ marginTop: 12 }}>
          {tab === "logs"
            ? (logs === null ? <SkeletonRows rows={3} card={false} />
                : logs.length > 0
                  ? logs.map(function(g){ return <LogCard key={g.id} g={g} t={t} lang={lang} onClick={function(){ setLogView(g); }} />; })
                  : <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>Henüz log yok.</div>)
            : (comments === null ? <SkeletonRows rows={3} card={false} />
                : comments.length > 0
                  ? comments.map(function(cm){
                      var ctx = cm.match_name || cm.target_name || "";
                      return <div key={cm.id} style={box}>
                        <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.45, marginBottom: ctx ? 7 : 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{cm.body}</div>
                        {ctx && <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.textMuted }}>
                          <span style={{ fontWeight: 800, color: COLORS.accent }}>{cm.target_type === "player" ? t.playerTag : t.matchTag}</span>
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{ctx}</span>
                          <span style={{ marginLeft: "auto", flexShrink: 0 }}>{relTime(cm.created_at, lang)}</span>
                        </div>}
                      </div>; })
                  : <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>Henüz yorum yok.</div>)}
        </div>
      </div>
    </div>
  </div>
  {logView && <RatingDetailSheet match={{ id: logView.match_id, home: logView.home, away: logView.away, homeLogo: logView.home_logo, awayLogo: logView.away_logo, score: logView.score }}
    log={{ userId: userId, own: false, user: username, rating: Number(logView.rating), tags: logView.tags, attended: logView.attended, venue: logView.venue, photo: logView.photo }}
    t={t} onClose={function(){ setLogView(null); }} />}
  </>, document.body);
}

// Rate the 3 standouts side by side (sliders). Bottom sheet, mock/local.
// Player-detail bottom sheet for predicting a player's match rating (opens from the coupon pitch).
function PredRatingSheet({ player, initial, existing, t, onSave, onRemove, onClose }) {
  var [visible, setVisible] = useState(false);
  var [val, setVal] = useState(initial != null ? initial : 3.0);
  useEffect(function(){
    var r = requestAnimationFrame(function(){ setVisible(true); });
    function onKey(e){ if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    return function(){ cancelAnimationFrame(r); window.removeEventListener("keydown", onKey); };
  }, []);
  function close(){ setVisible(false); setTimeout(onClose, 280); }
  function save(){ onSave(Math.round(val * 10) / 10); close(); }
  function remove(){ if (onRemove) onRemove(); close(); }
  if (typeof document === "undefined") return null;
  // portal to body so position:fixed is relative to the viewport (the match modal uses transform)
  return createPortal(<div onClick={close}
    onTouchStart={function(e){ e.stopPropagation(); }} onTouchMove={function(e){ e.stopPropagation(); }} onTouchEnd={function(e){ e.stopPropagation(); }}
    style={{ position: "fixed", inset: 0, zIndex: 1300, display: "flex", alignItems: "flex-end", justifyContent: "center",
    background: visible ? "rgba(12,14,18,0.55)" : "rgba(12,14,18,0)", transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} style={{ width: "100%", maxWidth: 480, background: "var(--modalGrad)",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      borderTopLeftRadius: 24, borderTopRightRadius: 24, border: "1px solid var(--modalBorder)", borderBottom: "none",
      padding: "12px 20px max(24px, env(safe-area-inset-bottom))", fontFamily: FONT, maxHeight: "90vh", overflowY: "auto",
      transform: visible ? "translateY(0)" : "translateY(100%)", transition: "transform 0.34s cubic-bezier(0.22,1,0.36,1)", boxShadow: "0 -8px 40px rgba(20,40,40,0.22)" }}>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 16px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
        <PredHead photo={player.photo} size={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{player.name}</div>
          <div style={{ color: COLORS.textSecondary, fontSize: 13 }}>{locTeam(player.team, t)}{player.position ? " · " + player.position : ""}</div>
        </div>
      </div>
      <div style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600, margin: "8px 0 16px" }}>Maç sonu alacağı reytingi tahmin et</div>
      <div style={{ textAlign: "center", fontSize: 46, fontWeight: 800, color: COLORS.accent, marginBottom: 16, lineHeight: 1 }}>{val.toFixed(1)}</div>
      <RatingSlider value={val} onChange={setVal} />
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        {existing && <button onClick={remove} style={{ padding: "12px 18px", borderRadius: 13, border: "1px solid " + COLORS.border,
          background: "transparent", color: COLORS.textSecondary, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>Kaldır</button>}
        <button onClick={save} style={{ marginLeft: "auto", flex: existing ? "0 0 auto" : 1, padding: "12px 22px", borderRadius: 13, border: "none",
          background: COLORS.accent, color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>Kaydet</button>
      </div>
    </div>
  </div>, document.body);
}

function StandoutsRating({ players, t, onClose }) {
  var [visible, setVisible] = useState(false);
  var [ratings, setRatings] = useState(function(){ return players.map(function(p){ return p.rating != null ? p.rating : 5; }); });
  useEffect(function(){
    var r = requestAnimationFrame(function(){ setVisible(true); });
    function onKey(e){ if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    return function(){ cancelAnimationFrame(r); window.removeEventListener("keydown", onKey); };
  }, []);
  function close(){ setVisible(false); setTimeout(onClose, 280); }
  function setOne(i, v){ setRatings(function(prev){ var n = prev.slice(); n[i] = v; return n; }); }

  return <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 120, display: "flex",
    alignItems: "flex-end", justifyContent: "center",
    background: visible ? "rgba(12,14,18,0.5)" : "rgba(12,14,18,0)", transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} style={{ width: "100%", maxWidth: 560, background: "var(--modalGrad)",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      borderTopLeftRadius: 24, borderTopRightRadius: 24, border: "1px solid var(--modalBorder)", borderBottom: "none",
      padding: "12px 18px max(24px, env(safe-area-inset-bottom))", fontFamily: FONT,
      transform: visible ? "translateY(0)" : "translateY(100%)",
      transition: "transform 0.34s cubic-bezier(0.22,1,0.36,1)", boxShadow: "0 -8px 40px rgba(20,40,40,0.22)" }}>
      <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 12px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800 }}>{t.standoutsTitle}</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {players.map(function(p, i){
          return <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            {p.photo ? <img src={p.photo} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid " + COLORS.accent }} />
              : <span style={{ width: 52, height: 52, borderRadius: "50%", background: COLORS.cardAlt, display: "inline-block" }} />}
            <div style={{ color: COLORS.textPrimary, fontSize: 12, fontWeight: 700, marginTop: 6,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 10, marginBottom: 6,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(p.team, t)}</div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><RatingBadge rating={p.rating} style={{ fontSize: 11, padding: "1px 6px" }} /></div>
            <div style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{ratings[i].toFixed(1)}</div>
            <RatingSlider value={ratings[i]} onChange={function(v){ setOne(i, v); }} />
          </div>;
        })}
      </div>
    </div>
  </div>;
}

// Boxless feed: today's matches then previous days, each under a small date header.
// Tab bar whose underline indicator slides smoothly to the active tab.
function UnderlineTabs({ tabs, active, onChange, baseline, indicatorColor }) {
  var ref = useRef(null);
  var [ind, setInd] = useState({ left: 0, width: 0 });
  useEffect(function(){
    function measure(){
      var el = ref.current; if (!el) return;
      var idx = tabs.findIndex(function(x){ return x.id === active; });
      var btn = idx >= 0 ? el.children[idx] : null;
      if (btn) setInd({ left: btn.offsetLeft, width: btn.offsetWidth });
    }
    measure();
    var id = setTimeout(measure, 50);
    window.addEventListener("resize", measure);
    return function(){ clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [active, tabs.map(function(x){ return x.label; }).join("|")]);
  return <div ref={ref} className="mo-scroll" style={{ position: "relative", display: "flex", gap: 22, overflowX: "auto",
    touchAction: "pan-x", overscrollBehaviorX: "contain",
    marginBottom: 6, borderBottom: baseline === false ? "none" : ("1px solid " + COLORS.border) }}>
    {tabs.map(function(tb){
      var a = active === tb.id;
      return <button key={tb.id} onClick={function(){ onChange(tb.id); }} style={{ flexShrink: 0, background: "transparent",
        border: "none", padding: "11px 2px", fontSize: 13, fontWeight: a ? 800 : 600, cursor: "pointer", whiteSpace: "nowrap",
        color: a ? COLORS.textPrimary : COLORS.textSecondary, transition: "color 0.2s", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>{tb.label}</button>; })}
    <span aria-hidden style={{ position: "absolute", bottom: -1, height: 2.5, borderRadius: 3, background: indicatorColor || COLORS.textPrimary,
      left: ind.left, width: ind.width, opacity: ind.width ? 1 : 0,
      transition: "left 0.3s cubic-bezier(0.22,1,0.36,1), width 0.3s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease", pointerEvents: "none" }} />
  </div>;
}

// Small "Canlı" pill label: cat1 icon + text + an always-blinking red dot.
function LiveTabLabel({ t }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <img src="/cat1.png" alt="" style={{ width: 15, height: 15, objectFit: "contain" }} />
    {t.liveTab}
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.4s infinite", display: "inline-block" }} />
  </span>;
}

// Main match feed: three tabs — Canlı (live only, by minute) | Oynanacak (live on top by minute,
// then upcoming grouped by day, same-kickoff ties broken by league order) | Biten (by league order).
function DayMatchList({ matches, t, isF1, onOpen }) {
  matches = matches || [];
  var live = matches.filter(function(m){ return m.status === "live"; });
  var [tab, setTab] = useState("upcoming"); // "live" | "upcoming" | "finished"
  if (matches.length === 0) return <EmptyState icon={<EmptyIcon name="ball" />} title={t.noMatches} hint="Başka bir güne veya lige göz at — yakında yeni maçlar burada." />;

  var todayKey = isoLocal(new Date());
  function dayHeader(k){ return k === todayKey ? t.todayLabel : (k.slice(8, 10) + "." + k.slice(5, 7) + "." + k.slice(0, 4)); }
  var card = { background: COLORS.card, borderRadius: 18, padding: "2px 10px 8px" };
  var sepStyle = { color: COLORS.textSecondary, fontSize: 12, fontWeight: 800, padding: "14px 4px 8px", borderBottom: "1px solid " + COLORS.border, marginBottom: 2 };
  function liveRows(){
    var items = live.slice().sort(function(a, b){ return (b.minute || 0) - (a.minute || 0); }); // latest minute first
    return items.map(function(m, i){ return <MatchRow key={m.id} match={m} isF1={isF1} t={t} showLeague={true}
      divider={i < items.length - 1} onOpen={function(){ onOpen(m); }} />; });
  }
  // small inline "Canlı" separator (icon + blinking dot) reused above the live rows
  var liveSep = <div style={Object.assign({}, sepStyle, { display: "flex", alignItems: "center", gap: 6 })}>
    <img src="/cat1.png" alt="" style={{ width: 14, height: 14, objectFit: "contain" }} />{t.liveTab}
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.4s infinite", display: "inline-block" }} /></div>;

  function renderLive(){
    if (!live.length) return <div style={{ textAlign: "center", padding: "44px 20px", color: COLORS.textMuted, fontSize: 13 }}>{t.noLiveMatches || t.noMatches}</div>;
    return <div style={card}>{liveRows()}</div>;
  }
  function renderUpcoming(){
    var up = matches.filter(function(m){ return m.status === "upcoming"; });
    var groups = {};
    up.forEach(function(m){ var k = m.dateKey || todayKey; if (!groups[k]) groups[k] = []; groups[k].push(m); });
    var keys = Object.keys(groups).sort(function(a, b){ return a < b ? -1 : a > b ? 1 : 0; }); // soonest day first
    if (!live.length && !keys.length) return <div style={{ textAlign: "center", padding: "44px 20px", color: COLORS.textMuted, fontSize: 13 }}>{t.noMatches}</div>;
    return <div style={card}>
      {live.length > 0 && <div style={{ marginBottom: 4 }}>{liveSep}{liveRows()}</div>}
      {keys.map(function(k){
        // within a day: earliest kickoff first; same kickoff -> our league order (WC, ŞL, UEL...)
        var items = groups[k].slice().sort(function(a, b){ return ((a.ts || 0) - (b.ts || 0)) || (leaguePri(a) - leaguePri(b)); });
        return <div key={k} style={{ marginBottom: 4 }}>
          <div style={sepStyle}>{dayHeader(k)}</div>
          {items.map(function(m, i){ return <MatchRow key={m.id} match={m} isF1={isF1} t={t} showLeague={true}
            divider={i < items.length - 1} onOpen={function(){ onOpen(m); }} />; })}
        </div>;
      })}
    </div>;
  }

  return <div>
    <UnderlineTabs indicatorColor={COLORS.accent} active={tab} onChange={setTab}
      tabs={[{ id: "live", label: <LiveTabLabel t={t} /> }, { id: "upcoming", label: t.upcomingTab }, { id: "finished", label: t.finishedTab }]} />
    {tab === "live" ? renderLive()
      : tab === "finished"
        ? <LeagueGroupedList matches={matches.filter(function(m){ return m.status === "finished"; })} t={t} onOpen={onOpen} empty={t.noMatches} />
        : renderUpcoming()}
  </div>;
}

// League priority for ordering: WC(1) > UCL(2) > UEL(3) > Conf(848) > Premier(39) > rest.
// Same-kickoff tiebreak + finished-tab grouping order: big competitions on top, everything else normal.
var LEAGUE_PRIORITY = {
  1: 1,    // World Cup
  2: 2,    // Champions League
  3: 3,    // Europa League
  848: 4,  // Conference League
  39: 5,   // Premier League
  140: 6,  // La Liga
  135: 7,  // Serie A
  78: 8,   // Bundesliga
  61: 9,   // Ligue 1
  203: 10, // Süper Lig
};
function leaguePri(m) { return LEAGUE_PRIORITY[m && m.leagueId] || 999; }

// Matches grouped by league (never by day). World Cup on top, then the big European cups and
// top leagues, everything else after — mirrors the World Cup group layout. Used for finished/live.
function LeagueGroupedList({ matches, t, onOpen, empty }) {
  if (!matches || matches.length === 0)
    return <div style={{ textAlign: "center", padding: "44px 20px", color: COLORS.textMuted, fontSize: 13 }}>{empty || t.noMatches}</div>;
  var PRIORITY = LEAGUE_PRIORITY;
  var groups = {}, order = [];
  matches.forEach(function(m){
    var k = String(m.leagueId != null ? m.leagueId : (m.league || "?"));
    if (!groups[k]) { groups[k] = { id: m.leagueId, name: m.league, logo: m.leagueLogo, items: [] }; order.push(k); }
    groups[k].items.push(m);
  });
  var origIndex = {}; order.forEach(function(k, i){ origIndex[k] = i; });
  order.sort(function(a, b){
    var pa = PRIORITY[a] || 999, pb = PRIORITY[b] || 999;
    return pa !== pb ? pa - pb : origIndex[a] - origIndex[b];
  });
  return <div style={{ background: COLORS.card, borderRadius: 18, padding: "2px 10px 8px" }}>
    {order.map(function(k){
      var g = groups[k]; var logo = leagueLogo(g.id, g.logo);
      return <div key={k} style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 4px 8px",
          borderBottom: "1px solid " + COLORS.border, marginBottom: 2 }}>
          {logo && <img src={logo} alt="" style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }} />}
          <span style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 800 }}>{g.name || ""}</span>
        </div>
        {g.items.slice().sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); }) // most-recently-finished first
          .map(function(m, i, arr){ return <MatchRow key={m.id} match={m} isF1={false} t={t}
            divider={i < arr.length - 1} onOpen={function(){ onOpen(m); }} />; })}
      </div>;
    })}
  </div>;
}

// Horizontal league strip (mobile): flattened league chips, World Cup first; tap -> detail below.
function LeagueStrip({ groups, selectedId, onSelect, onClear, t }) {
  var leagues = [];
  (groups || []).forEach(function(g){ (g.leagues || []).forEach(function(l){ leagues.push(l); }); });
  if (!leagues.length) return null;
  // surface the big competitions first; everything else keeps its original order
  var PRIORITY = { 1: 1, 2: 2, 3: 3, 848: 4, 39: 5, 203: 6, 140: 7, 78: 8, 135: 9, 61: 10 };
  leagues = leagues.map(function(l, i){ return { l: l, i: i }; }).sort(function(a, b){
    var pa = PRIORITY[a.l.id] || 999, pb = PRIORITY[b.l.id] || 999;
    return pa !== pb ? pa - pb : a.i - b.i;
  }).map(function(x){ return x.l; });
  function chip(active){ return { flexShrink: 0, display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 11,
    border: "1px solid " + (active ? COLORS.accent : COLORS.border),
    background: active ? COLORS.accentDim : "transparent",
    color: active ? COLORS.accent : COLORS.textSecondary, fontSize: 12, fontWeight: active ? 800 : 600, cursor: "pointer",
    fontFamily: FONT, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }; }
  return <div className="mo-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
    <button onClick={onClear} className="mo-lgchip" style={chip(!selectedId)}>{t.allLabel}</button>
    {leagues.map(function(l){
      var a = selectedId === l.id;
      return <button key={l.id} onClick={function(){ onSelect(l); }} className="mo-lgchip" style={chip(a)}>
        {leagueLogo(l.id, l.logo) && <img src={leagueLogo(l.id, l.logo)} onError={logoFallback(l.logo)} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
        <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
      </button>; })}
  </div>;
}

// Compact row used inside the right-side list container.
function MatchRow({ match, isF1, onOpen, t, divider, showDate, showLeague }) {
  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");
  var [hover, setHover] = useState(false);

  return <><div onClick={onOpen}
    onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
    style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 12px", borderRadius: 16, cursor: "pointer",
      background: hover ? "rgba(106,69,230,0.10)" : "transparent",
      transition: "background 0.3s cubic-bezier(0.22,1,0.36,1)", WebkitTapHighlightColor: "transparent" }}>
    <div style={{ width: showLeague && !isF1 ? 62 : 56, flexShrink: 0 }}>
      {isLive ? <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.red, background: COLORS.red + "18",
        padding: "2px 7px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.5s infinite", display: "inline-block" }} />
        {match.minute ? match.minute + "'" : t.live}</span>
      : <span style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 700 }}>{((showDate || match.status === "finished") && match.date) ? match.date : match.time}</span>}
      {showLeague && !isF1 && match.league && <div style={{ color: COLORS.textMuted, fontSize: 9, fontWeight: 700, marginTop: 3, lineHeight: 1.15,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{match.league}</div>}
    </div>
    {isF1 ? <div style={{ flex: 1, color: COLORS.textPrimary, fontSize: 14, fontWeight: 700 }}>{match.home}</div>
    : <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minWidth: 0 }}>
          <TeamLogo src={match.homeLogo} name={locTeam(match.home, t)} size={20} />
          <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{locTeam(match.home, t)}</span>
          {showScore && <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 800 }}>{match.score ? match.score.split(" - ")[0] : ""}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <TeamLogo src={match.awayLogo} name={locTeam(match.away, t)} size={20} />
          <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{locTeam(match.away, t)}</span>
          {showScore && <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 800 }}>{match.score ? match.score.split(" - ")[1] : ""}</span>}
        </div>
      </div>}
    <Quick1x2 match={match} layout="card" />
    {match.status === "finished" ? <RatingCount match={match} /> : <PredCount match={match} />}
  </div>
  {divider && <div style={{ height: 1, background: COLORS.border, margin: "0 14px" }} />}
  </>;
}

// Right-side actions on a match card: comment count (icon + real count) then the save button.
function MatchCardActions({ match, isF1, t }) {
  var count = useCommentCount(match.id);
  var favName = isF1 ? match.home : (locTeam(match.home, t) + " - " + locTeam(match.away, t));
  return <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: COLORS.textMuted,
      fontSize: 12, fontWeight: 700, padding: "0 2px" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {count}
    </span>
    <FavButton kind="match" refId={match.id} name={favName} image={match.homeLogo} meta={matchSnap(match)} size={30} />
  </div>;
}

function MatchCard({ match, isF1, onOpen, t }) {
  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");
  var [hover, setHover] = useState(false);

  var border = hover ? COLORS.accent + "44" : (isLive ? COLORS.accent + "55" : COLORS.border);
  var bg = hover ? "rgba(106,69,230,0.04)" : COLORS.card;

  return <div style={{ background: COLORS.card, borderRadius: 24, overflow: "hidden", marginBottom: 12,
    WebkitTransform: "translateZ(0)", transform: "translateZ(0)",
    border: "1px solid " + border,
    transition: "border-color 0.4s ease" }}>
    <div onClick={onOpen}
      onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
      style={{ padding: "20px 22px", cursor: "pointer", display: "flex",
      alignItems: "center", justifyContent: "space-between", WebkitTapHighlightColor: "transparent",
      background: bg, transition: "background 0.45s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          {isLive ? <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.red, background: COLORS.red + "18",
            padding: "2px 9px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.red, animation: "pulse 1.5s infinite", display: "inline-block" }} />{t.live}{match.minute ? " " + match.minute + "'" : ""}</span>
          : match.status === "finished" ? <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            <span style={{ fontWeight: 700, color: COLORS.textSecondary }}>{match.league}</span>{"  ·  "}
            <span style={{ fontWeight: 700, color: COLORS.accent }}>{t.finished}</span></span>
          : <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            <span style={{ fontWeight: 700, color: COLORS.textSecondary }}>{match.league}</span>{match.date ? "  ·  " + match.date : ""}</span>}
        </div>
        {isF1 ? <div style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: 700 }}>{locTeam(match.home, t)}</div>
        : <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9 }}>
              <TeamLogo src={match.homeLogo} name={locTeam(match.home, t)} />
              <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 700 }}>{locTeam(match.home, t)}</span></div>
            <div style={{ minWidth: 58, textAlign: "center", padding: "5px 10px", borderRadius: 12,
              background: showScore ? COLORS.accentDim : COLORS.cardAlt }}>
              {showScore ? <span style={{ color: COLORS.accent, fontSize: 16, fontWeight: 800 }}>{match.score}</span>
               : <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 700 }}>{match.time}</span>}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-end" }}>
              <span style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 700, textAlign: "right" }}>{locTeam(match.away, t)}</span>
              <TeamLogo src={match.awayLogo} name={locTeam(match.away, t)} /></div>
          </div>}
      </div>
      <div style={{ marginLeft: 14, color: hover ? COLORS.accent : COLORS.textMuted, fontSize: 18, fontWeight: 700,
        transition: "color 0.3s ease" }}>›</div>
    </div>
  </div>;
}

// Drag the bottom-sheet down to dismiss (mobile). Only engages when scrolled to the top.
function useSheetDrag(onClose) {
  var [dragY, setDragY] = useState(0);
  var [dragging, setDragging] = useState(false);
  var startRef = useRef(null);
  function onTouchStart(e) {
    if (e.currentTarget.scrollTop > 0) { startRef.current = null; return; }
    startRef.current = e.touches[0].clientY;
  }
  function onTouchMove(e) {
    if (startRef.current == null) return;
    var dy = e.touches[0].clientY - startRef.current;
    var DZ = 14; // deadzone: ignore tiny/slow pulls so casual scrolling at the top doesn't reveal the backdrop
    if (dy > DZ) { if (!dragging) setDragging(true); setDragY(dy - DZ); }
    else { if (dragging) setDragging(false); setDragY(0); }
  }
  function onTouchEnd() {
    if (startRef.current == null) return;
    startRef.current = null;
    setDragging(false);
    if (dragY > 110) onClose(); else setDragY(0);
  }
  return { dragY: dragY, dragging: dragging, handlers: { onTouchStart: onTouchStart, onTouchMove: onTouchMove, onTouchEnd: onTouchEnd } };
}

// Full-screen modal popup (in-page overlay, not a route). Smooth open/close.
// Small AI pre-match analysis button (header). Generates on tap; shows the analysis in a
// popover — on hover (desktop) or tap (mobile). Self-contained so it can live in the header.
function AiAnalysisButton({ match, detail, t }) {
  var [text, setText] = useState(null);
  var [loading, setLoading] = useState(false);
  var [err, setErr] = useState(null);
  var [open, setOpen] = useState(false);
  useEffect(function(){
    if (match.status === "finished" || !match.id) return;
    var cancelled = false;
    fetch("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matchId: match.id, peek: true }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (!cancelled && j && j.text) setText(j.text); }).catch(function(){});
    return function(){ cancelled = true; };
  }, [match.id]);

  function generate(){
    if (loading) return;
    if (text) { setOpen(function(o){ return !o; }); return; } // already generated -> toggle popover
    setLoading(true); setErr(null); setOpen(true);
    var homeId = match.homeId, awayId = match.awayId;
    var h2hP = (homeId && awayId) ? fetch("/api/football?mode=h2h&home=" + homeId + "&away=" + awayId).then(function(r){ return r.json(); }).then(function(j){ return j.h2h || null; }).catch(function(){ return null; }) : Promise.resolve(null);
    var stP = match.leagueId ? fetch("/api/football?mode=standings&league=" + match.leagueId + "&season=" + (match.season || 2025)).then(function(r){ return r.json(); }).then(function(j){ return (j.standings && j.standings.groups) ? j.standings.groups : []; }).catch(function(){ return []; }) : Promise.resolve([]);
    Promise.all([h2hP, stP]).then(function(res){
      var hh = res[0], groups = res[1];
      function rowFor(id){ for (var g = 0; g < groups.length; g++){ var rows = groups[g].rows || []; for (var i = 0; i < rows.length; i++){ var rw = rows[i]; if (String(rw.teamId) === String(id)) return { team: locTeam(rw.team, t), rank: i + 1, played: rw.played, win: rw.win, draw: rw.draw, lose: rw.lose, gd: rw.gd, points: rw.points }; } } return null; }
      var standRows = [rowFor(homeId), rowFor(awayId)].filter(Boolean);
      var season = (detail && detail.season && (detail.season.home || detail.season.away)) ? { home: detail.season.home, away: detail.season.away } : null;
      var ctx = { matchId: match.id, status: match.status, home: locTeam(match.home, t), away: locTeam(match.away, t), league: match.league, date: match.date, standings: standRows, season: season, h2h: (hh && hh.total != null) ? hh : null };
      return fetch("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ctx) }).then(function(r){ return r.json(); });
    }).then(function(j){ if (j && j.text) { setText(j.text); aiMarkSeen(match.id); } else setErr(j && j.error === "no_key" ? "AI ayarlı değil." : "Analiz oluşturulamadı."); })
      .catch(function(){ setErr("Analiz oluşturulamadı."); }).finally(function(){ setLoading(false); });
  }

  if (match.status === "finished") return null; // pre-match analysis only
  var showPop = open && (text || loading || err);
  return <div style={{ position: "relative", display: "inline-block" }}
    onMouseEnter={function(){ if (text) setOpen(true); }} onMouseLeave={function(){ if (text) setOpen(false); }}>
    <button onClick={generate} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 13px", borderRadius: 999,
      border: "1px solid " + COLORS.glassBorder, background: COLORS.glassPurple, cursor: "pointer", color: COLORS.accent, fontSize: 12, fontWeight: 700, fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9z" /></svg>
      {loading ? "Analiz…" : "AI Analizi"}
    </button>
    {showPop && <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 8, zIndex: 40,
      width: "min(340px, 86vw)", background: COLORS.card, border: "1px solid " + COLORS.glassBorder, borderRadius: 14, padding: "12px 14px",
      boxShadow: "0 12px 36px rgba(20,40,40,0.30)", textAlign: "left" }}>
      {loading ? <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: "4px 0" }}>Analiz hazırlanıyor…</div>
        : err ? <div style={{ color: COLORS.textMuted, fontSize: 12.5 }}>{err}</div>
          : <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{text}</div>}
    </div>}
  </div>;
}

function MatchModal({ match, isF1, t, onClose }) {
  var [visible, setVisible] = useState(false);
  var [detail, setDetail] = useState(undefined); // undefined = not fetched yet
  var [dtLoading, setDtLoading] = useState(false);
  var [jumpComments, setJumpComments] = useState(0); // bump -> MatchDetail switches to the comments tab

  useEffect(function(){
    // trigger enter transition on next frame
    var r = requestAnimationFrame(function(){ setVisible(true); });
    // lock background scroll
    var prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e){ if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    // fetch match detail once (lineups/stats/timeline/injuries/season) for header summary + tabs
    if (!isF1 && match.id) {
      setDtLoading(true);
      fetch("/api/football?mode=detail&match=" + match.id +
        "&league=" + (match.leagueId || "") + "&season=" + (match.season || 2025) +
        "&home=" + (match.homeId || "") + "&away=" + (match.awayId || "") +
        "&status=" + (match.status || ""))
        .then(function(r){ return r.json(); })
        .then(function(j){ setDetail(j.detail || { lineups: null, stats: null, subs: [], timeline: [], injuries: [], season: null, playerStats: { home: [], away: [] } }); })
        .catch(function(){ setDetail({ lineups: null, stats: null, subs: [], timeline: [], injuries: [], season: null, playerStats: { home: [], away: [] } }); })
        .finally(function(){ setDtLoading(false); });
    } else {
      setDetail(null);
    }
    return function(){
      cancelAnimationFrame(r);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 360); // wait for exit animation
  }
  var drag = useSheetDrag(handleClose);

  var isLive = match.status === "live";
  var showScore = match.score && (isLive || match.status === "finished");

  return <div onClick={handleClose} style={{ position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", justifyContent: "center", alignItems: "flex-end",
    background: visible ? "rgba(12,14,18,0.5)" : "rgba(12,14,18,0)",
    transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} className="mo-scroll mo-matchsheet"
      onTouchStart={drag.handlers.onTouchStart} onTouchMove={drag.handlers.onTouchMove} onTouchEnd={drag.handlers.onTouchEnd} style={{
      width: "100%", maxWidth: 720, overflowY: "auto", overflowX: "hidden", fontFamily: FONT,
      WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y",
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      background: "var(--modalGrad)", backdropFilter: "blur(30px) saturate(170%)", WebkitBackdropFilter: "blur(30px) saturate(170%)",
      border: "1px solid var(--modalBorder)", borderBottom: "none",
      transform: visible ? ("translateY(" + drag.dragY + "px)") : "translateY(100%)",
      transition: drag.dragging ? "none" : "transform 0.34s cubic-bezier(0.22,1,0.36,1)" }}>

      {/* modal header: drag handle + teams + score + close. Glassy (frosted) with a visible purple tint. */}
      <div className="mo-sticky" style={{ zIndex: 5, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        background: "linear-gradient(180deg, rgba(106,69,230,0.26), rgba(106,69,230,0.10))",
        backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)",
        borderBottom: "1px solid rgba(106,69,230,0.22)",
        padding: "max(10px, env(safe-area-inset-top)) 18px 14px" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: COLORS.border, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary }}>
            {match.league}{isLive ? "" : (match.date ? "  ·  " + match.date : "")}
            {isLive && <span style={{ color: COLORS.red, marginLeft: 8 }}>● {t.live}{match.minute ? " " + match.minute + "'" : ""}</span>}
          </span>
          <button onClick={handleClose} aria-label="close" style={{ width: 30, height: 30, borderRadius: 8, border: "none",
            background: "transparent", cursor: "pointer", color: COLORS.textSecondary, padding: 0, display: "flex",
            alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {isF1 ? <div style={{ color: COLORS.textPrimary, fontSize: 20, fontWeight: 800 }}>{locTeam(match.home, t)}</div>
        : <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              {match.homeId != null && <FavButton kind="team" refId={match.homeId} name={match.home} image={match.homeLogo} meta={{ leagueId: match.leagueId }} size={28} />}
              <TeamLogo src={match.homeLogo} name={locTeam(match.home, t)} size={42} />
              <span className="mo-team-name" style={{ color: COLORS.textPrimary, fontWeight: 800,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{locTeam(match.home, t)}</span></div>
            <div style={{ minWidth: 66, textAlign: "center", padding: "7px 12px", borderRadius: 14, flexShrink: 0,
              display: "flex", flexDirection: "column", alignItems: "center",
              background: showScore ? COLORS.accentDim : COLORS.cardAlt }}>
              {showScore ? <span style={{ color: CURRENT_THEME === "dark" ? "#fff" : COLORS.accent, fontSize: 22, fontWeight: 800 }}>{match.score}</span>
               : <span style={{ color: COLORS.textSecondary, fontSize: 15, fontWeight: 700 }}>{match.time}</span>}
              {match.penScore && <span style={{ color: COLORS.textSecondary, fontSize: 10, fontWeight: 700, marginTop: 1 }}>Pen. {match.penScore}</span>}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, justifyContent: "flex-end", minWidth: 0 }}>
              <span className="mo-team-name" style={{ color: COLORS.textPrimary, fontWeight: 800, textAlign: "right",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{locTeam(match.away, t)}</span>
              <TeamLogo src={match.awayLogo} name={locTeam(match.away, t)} size={42} />
              {match.awayId != null && <FavButton kind="team" refId={match.awayId} name={match.away} image={match.awayLogo} meta={{ leagueId: match.leagueId }} size={28} />}</div>
          </div>}

        {/* small "yorum yap" button + AI analysis button right under the score / time */}
        {!isF1 && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button onClick={function(){ setJumpComments(function(n){ return n + 1; }); }} style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 13px", borderRadius: 999, border: "1px solid " + COLORS.border, background: COLORS.card, cursor: "pointer",
            color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="13" rx="3" /><path d="M8 17l-2 4v-4" /></svg>
            {t.commentDo}
          </button>
          <AiAnalysisButton match={match} detail={detail} t={t} />
        </div>}

        {/* goal + red card summary under the score */}
        {detail && detail.timeline && (function(){
          var key = detail.timeline.filter(function(ev){
            return (ev.type === "goal" && ev.detail !== "Missed Penalty") || (ev.type === "card" && ev.detail === "Red Card");
          });
          if (key.length === 0) return null;
          // group goals by scorer so a multi-goal player is ONE line (name + all minutes); reds stay separate
          function rowsFor(side){
            var evs = key.filter(function(e){ return e.side === side; });
            var groups = {}, order = [], reds = [];
            evs.forEach(function(ev){
              if (ev.type === "goal") {
                var k = ev.player || "?";
                if (!groups[k]) { groups[k] = { player: ev.player, mins: [] }; order.push(k); }
                groups[k].mins.push({ m: ev.minute, label: ev.detail === "Penalty" ? "P" : (ev.detail === "Own Goal" ? "KG" : null), own: ev.detail === "Own Goal" });
              } else reds.push(ev);
            });
            var rows = order.map(function(k){ return { goal: groups[k] }; });
            reds.forEach(function(ev){ rows.push({ red: ev }); });
            return rows;
          }
          function minsEl(g){
            return g.mins.map(function(mm, i){
              return <span key={i}>{i > 0 ? ", " : ""}<span style={{ color: COLORS.textMuted }}>{mm.m}'</span>{mm.label ? <span style={{ color: mm.own ? COLORS.red : COLORS.accent, fontWeight: 800 }}> ({mm.label})</span> : null}</span>;
            });
          }
          function row(r, alignRight){
            if (r.goal) {
              return <div style={{ display: "flex", justifyContent: alignRight ? "flex-end" : "flex-start", marginBottom: 3 }}>
                <span style={{ color: COLORS.textSecondary, fontSize: 11, textAlign: alignRight ? "right" : "left" }}>
                  {alignRight ? <>{minsEl(r.goal)} {r.goal.player}</> : <>{r.goal.player} {minsEl(r.goal)}</>}
                </span></div>;
            }
            var ev = r.red;
            return <div style={{ display: "flex", alignItems: "center", justifyContent: alignRight ? "flex-end" : "flex-start", marginBottom: 3 }}>
              <span style={{ color: COLORS.textSecondary, fontSize: 11, textAlign: alignRight ? "right" : "left" }}>
                {alignRight && ev.minute != null && <span style={{ color: COLORS.textMuted }}>{ev.minute}' </span>}
                {ev.player}
                <span aria-label="kırmızı kart" style={{ display: "inline-block", width: 7, height: 10, borderRadius: 2, background: COLORS.red, verticalAlign: "-1px", marginLeft: 4 }} />
                {!alignRight && ev.minute != null && <span style={{ color: COLORS.textMuted }}> {ev.minute}'</span>}
              </span></div>;
          }
          var homeRows = rowsFor("home"), awayRows = rowsFor("away");
          return <div style={{ display: "flex", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(106,69,230,0.18)" }}>
            <div style={{ flex: 1 }}>{homeRows.map(function(r, i){ return <div key={i}>{row(r, false)}</div>; })}</div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>{awayRows.map(function(r, i){ return <div key={i} style={{ width: "100%" }}>{row(r, true)}</div>; })}</div>
          </div>;
        })()}
      </div>

      <div style={{ padding: "0 0 max(40px, env(safe-area-inset-bottom))" }}>
        <MatchDetail match={match} isF1={isF1} t={t} sharedDetail={detail} sharedLoading={dtLoading} jumpComments={jumpComments} />
      </div>
    </div>
  </div>;
}

// One player row in the search results list.
function PlayerRow({ player, t, onOpen }) {
  var [hover, setHover] = useState(false);
  return <div onClick={onOpen} onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 16, cursor: "pointer",
      background: hover ? "rgba(106,69,230,0.10)" : "transparent", transition: "background 0.3s cubic-bezier(0.22,1,0.36,1)",
      WebkitTapHighlightColor: "transparent" }}>
    {player.photo
      ? <img src={player.photo} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      : <span style={{ width: 38, height: 38, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 14, fontWeight: 700 }}>
          {(player.name || "?")[0]}</span>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{player.name}</div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {[player.position, player.nationality].filter(Boolean).join(" · ")}</div>
    </div>
    <FavButton kind="player" refId={player.id} name={player.name} image={player.photo}
      meta={{ position: player.position || null, nationality: player.nationality || null }} />
  </div>;
}

// One clickable team row in the search results.
function TeamRow({ team, t, onOpen }) {
  var [hover, setHover] = useState(false);
  return <div onClick={onOpen} onMouseEnter={function(){ setHover(true); }} onMouseLeave={function(){ setHover(false); }}
    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 16, cursor: "pointer",
      background: hover ? "rgba(106,69,230,0.10)" : "transparent", transition: "background 0.3s cubic-bezier(0.22,1,0.36,1)",
      WebkitTapHighlightColor: "transparent" }}>
    <TeamLogo src={team.logo} name={team.name} size={34} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(team.name, t)}</div>
      {team.country && <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{team.country}</div>}
    </div>
    <FavButton kind="team" refId={team.id} name={team.name} image={team.logo} meta={{ country: team.country || null }} />
  </div>;
}

// SofaScore-style discovery shown on the mobile search screen before a query is typed:
// popular leagues + the featured league's top scorers + standings.
function SearchDiscovery({ t, onOpenLeague, onOpenTeam, onOpenPlayer }) {
  var popular = [
    { id: 2, name: "Şampiyonlar Ligi", season: 2025 }, { id: 39, name: "Premier Lig", season: 2025 },
    { id: 140, name: "La Liga", season: 2025 }, { id: 135, name: "Serie A", season: 2025 },
    { id: 78, name: "Bundesliga", season: 2025 }, { id: 61, name: "Ligue 1", season: 2025 },
    { id: 203, name: "Süper Lig", season: 2025 }, { id: 1, name: "Dünya Kupası", season: 2026 },
  ];
  var featured = { id: 39, name: "Premier Lig", season: 2025 };
  var [scorers, setScorers] = useState(null);
  var [teams, setTeams] = useState(null);
  useEffect(function(){
    var cancelled = false;
    fetch("/api/football?mode=scorers&league=" + featured.id + "&season=" + featured.season)
      .then(function(r){ return r.json(); }).then(function(j){ if (!cancelled) setScorers((j.scorers || []).slice(0, 5)); }).catch(function(){ if (!cancelled) setScorers([]); });
    fetch("/api/football?mode=standings&league=" + featured.id + "&season=" + featured.season)
      .then(function(r){ return r.json(); }).then(function(j){ var g = j.standings && j.standings.groups && j.standings.groups[0]; if (!cancelled) setTeams(g && g.rows ? g.rows.slice(0, 5) : []); }).catch(function(){ if (!cancelled) setTeams([]); });
    return function(){ cancelled = true; };
  }, []);
  var sectionLabel = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", margin: "0 2px 12px" };
  var card = { background: COLORS.card, borderRadius: 18, padding: 8 };
  var loadingStyle = { textAlign: "center", padding: "20px 0", color: COLORS.textMuted, fontSize: 13 };

  return <div className="mo-container" style={{ animation: "moFade 0.26s ease both" }}>
    <div style={{ marginBottom: 24 }}>
      <div style={sectionLabel}>{t.popularLeagues}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {popular.map(function(l){
          return <button key={l.id} onClick={function(){ onOpenLeague(l); }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, padding: "12px 6px", background: COLORS.card,
              border: "none", borderRadius: 16, cursor: "pointer", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
            <img src={leagueLogo(l.id, "https://media.api-sports.io/football/leagues/" + l.id + ".png")} alt=""
              onError={logoFallback("https://media.api-sports.io/football/leagues/" + l.id + ".png")}
              style={{ width: 34, height: 34, objectFit: "contain" }} />
            <span style={{ color: COLORS.textSecondary, fontSize: 10.5, fontWeight: 600, textAlign: "center", lineHeight: 1.2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{l.name}</span>
          </button>; })}
      </div>
    </div>

    <div style={{ marginBottom: 24 }}>
      <div style={sectionLabel}>{t.scorers} · {featured.name}</div>
      {scorers === null ? <div style={loadingStyle}>{t.loading}</div>
       : scorers.length === 0 ? null
       : <div style={card}>{scorers.map(function(p, i){
          return <div key={i} onClick={function(){ if (p.id) onOpenPlayer({ id: p.id, name: p.name, photo: p.photo }); }}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: p.id ? "pointer" : "default",
              borderBottom: i < scorers.length - 1 ? "1px solid " + COLORS.border : "none", WebkitTapHighlightColor: "transparent" }}>
            <span style={{ width: 16, color: COLORS.textMuted, fontSize: 12, fontWeight: 700, textAlign: "center" }}>{i + 1}</span>
            {p.photo ? <img src={p.photo} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              : <span style={{ width: 34, height: 34, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ color: COLORS.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(p.team, t)}</div>
            </div>
            <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800, flexShrink: 0 }}>{p.goals}</span>
          </div>; })}</div>}
    </div>

    <div>
      <div style={sectionLabel}>{t.standing} · {featured.name}</div>
      {teams === null ? <div style={loadingStyle}>{t.loading}</div>
       : teams.length === 0 ? null
       : <div style={card}>{teams.map(function(rw, i){
          return <div key={i} onClick={function(){ onOpenTeam({ id: rw.teamId, name: rw.team, logo: rw.logo }); }}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer",
              borderBottom: i < teams.length - 1 ? "1px solid " + COLORS.border : "none", WebkitTapHighlightColor: "transparent" }}>
            <span style={{ width: 16, color: COLORS.textMuted, fontSize: 12, fontWeight: 700, textAlign: "center" }}>{i + 1}</span>
            {rw.logo && <img src={rw.logo} alt="" style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} />}
            <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(rw.team, t)}</span>
            <span style={{ color: COLORS.textMuted, fontSize: 12, width: 26, textAlign: "center" }}>{rw.played != null ? rw.played : "-"}</span>
            <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 800, width: 24, textAlign: "center" }}>{rw.points != null ? rw.points : "-"}</span>
          </div>; })}</div>}
    </div>
  </div>;
}

// Search view: teams + their matches (local + API) + players (API). Replaces the normal list while a query is active.
function SearchResults({ teams, matches, players, searching, isF1, t, onOpenMatch, onOpenPlayer, onOpenTeam }) {
  var titleStyle = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 10 };
  var box = { background: COLORS.card, borderRadius: 22, border: "1px solid " + COLORS.border, padding: 8 };
  var empty = { color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "16px 0" };
  var drop = function(delay){ return { animation: "moDrop 0.34s cubic-bezier(0.22,1,0.36,1) both", animationDelay: delay }; };
  return <div className="mo-container">
    {teams && teams.length > 0 && <div style={Object.assign({ marginBottom: 22 }, drop("0s"))}>
      <div style={titleStyle}>{t.teamsLabel}</div>
      <div style={box}>{teams.map(function(tm){
        return <TeamRow key={tm.id} team={tm} t={t} onOpen={function(){ onOpenTeam(tm); }} />; })}</div>
    </div>}
    <div style={Object.assign({ marginBottom: 22 }, drop("0.07s"))}>
      <div style={titleStyle}>{t.matches}</div>
      {searching && matches.length === 0 ? <div style={empty}>{t.loading}</div>
       : matches.length === 0 ? <div style={empty}>{t.noMatches}</div>
       : <div style={box}>{matches.map(function(m, i){ return <MatchRow key={m.id} match={m} isF1={isF1} t={t} showDate={true}
           divider={i < matches.length - 1} onOpen={function(){ onOpenMatch(m); }} />; })}</div>}
    </div>
    <div style={drop("0.14s")}>
      <div style={titleStyle}>{t.players}</div>
      {searching ? <div style={empty}>{t.loading}</div>
       : players.length === 0 ? <div style={empty}>{t.noPlayerFound}</div>
       : <div style={box}>{players.map(function(p){ return <PlayerRow key={p.id} player={p} t={t}
           onOpen={function(){ onOpenPlayer(p); }} />; })}</div>}
    </div>
  </div>;
}

// Player profile page (season stats + per-competition breakdown + trophies). In-page overlay like MatchModal.
function PlayerModal({ player, t, onClose }) {
  var [visible, setVisible] = useState(false);
  var [data, setData] = useState(null);
  var [games, setGames] = useState(null); // last matches with the rating earned
  var [loading, setLoading] = useState(true);

  useEffect(function(){
    var r = requestAnimationFrame(function(){ setVisible(true); });
    var prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e){ if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    fetch("/api/football?mode=player&id=" + player.id + "&season=2025")
      .then(function(r){ return r.json(); })
      .then(function(j){
        var pl = j.player || null; setData(pl); setLoading(false);
        if (pl && pl.teamId && pl.id != null) {
          fetch("/api/football?mode=playergames&id=" + pl.id + "&team=" + pl.teamId + "&season=2025")
            .then(function(r){ return r.json(); }).then(function(g){ setGames((g && g.games) || []); }).catch(function(){ setGames([]); });
        } else setGames([]);
      })
      .catch(function(){ setData(null); setLoading(false); setGames([]); });
    return function(){
      cancelAnimationFrame(r);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleClose() { setVisible(false); setTimeout(onClose, 360); }
  var drag = useSheetDrag(handleClose);

  var pd = data;
  var totals = (pd && pd.totals) || {};
  var photo = (pd && pd.photo) || player.photo;
  var name = (pd && pd.name) || player.name;

  function statCard(label, value, accent) {
    return <div style={{ flex: 1, minWidth: 0, background: COLORS.card, border: "none",
      borderRadius: 14, padding: "12px 8px", textAlign: "center" }}>
      <div style={{ color: accent === true ? COLORS.accent : (accent || COLORS.textPrimary), fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 3 }}>{label}</div>
    </div>;
  }
  function seasonLabel(yr) { if (yr == null) return ""; var nx = String((yr + 1) % 100); if (nx.length < 2) nx = "0" + nx; return yr + "/" + nx; }

  return <div onClick={handleClose} style={{ position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", justifyContent: "center", alignItems: "flex-end",
    background: visible ? "rgba(12,14,18,0.5)" : "rgba(12,14,18,0)",
    transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} className="mo-scroll mo-matchsheet"
      onTouchStart={drag.handlers.onTouchStart} onTouchMove={drag.handlers.onTouchMove} onTouchEnd={drag.handlers.onTouchEnd} style={{
      width: "100%", maxWidth: 720, overflowY: "auto", overflowX: "hidden", fontFamily: FONT,
      WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", borderTopLeftRadius: 28, borderTopRightRadius: 28,
      background: "var(--modalGrad)",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      border: "1px solid var(--modalBorder)",
      transform: visible ? ("translate3d(0," + drag.dragY + "px,0)") : "translate3d(0,100%,0)",
      transition: drag.dragging ? "none" : "transform 0.4s cubic-bezier(0.22,1,0.36,1)",
      willChange: "transform", WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>

      {/* header: photo + name + team */}
      <div className="mo-sticky" style={{ zIndex: 5, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        background: "linear-gradient(180deg, rgba(106,69,230,0.16), rgba(106,69,230,0.06))",
        backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)",
        borderBottom: "1px solid rgba(106,69,230,0.18)", padding: "max(16px, env(safe-area-inset-top)) 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary }}>{t.plProfile}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {player && player.id != null && <FavButton kind="player" refId={player.id} name={name} image={photo} size={34} />}
            <button onClick={handleClose} aria-label="close" style={{ width: 36, height: 36, borderRadius: 12,
              border: "1px solid rgba(106,69,230,0.25)", background: "rgba(255,255,255,0.6)", cursor: "pointer", color: COLORS.textPrimary,
              fontSize: 18, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
              WebkitTapHighlightColor: "transparent" }}>×</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {photo
            ? <img src={photo} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
                border: "2px solid " + COLORS.accent }} />
            : <span style={{ width: 64, height: 64, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 24, fontWeight: 700 }}>
                {(name || "?")[0]}</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: 800,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
            <div style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {pd && pd.team && pd.team.logo && <img src={pd.team.logo} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />}
              {pd && pd.team && pd.team.name && <span>{locTeam(pd.team.name, t)}</span>}
              {((pd && pd.position) || player.position) && <span style={{ color: COLORS.textMuted }}>· {(pd && pd.position) || player.position}</span>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 18px max(40px, env(safe-area-inset-bottom))" }}>
        {loading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>{t.loading}</div>
         : !pd ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>{t.noPlayerFound}</div>
         : <div>
            <div style={{ color: COLORS.textSecondary, fontSize: 11, marginBottom: 10 }}>{t.plSeason} {seasonLabel(pd.season)}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {statCard(t.plApps, totals.appearances != null ? totals.appearances : "-")}
              {statCard(t.plGoals, totals.goals != null ? totals.goals : "-", true)}
              {statCard(t.plAssists, totals.assists != null ? totals.assists : "-", COLORS.purple)}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {statCard(t.plMinutes, totals.minutes != null ? totals.minutes : "-")}
              {statCard(t.plRating, totals.rating != null ? totals.rating.toFixed(2) : "-")}
              {statCard(t.plTrophies, pd.trophiesWon != null ? pd.trophiesWon : 0, true)}
            </div>

            {games && games.length > 0 && <div style={{ marginBottom: 18 }}>
              <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Son maçlar</div>
              {games.map(function(gm, i){
                var resCol = gm.result === "W" ? COLORS.purple : gm.result === "L" ? COLORS.red : COLORS.yellow;
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", marginBottom: 6, background: COLORS.card, borderRadius: 12 }}>
                  {gm.result && <span style={{ width: 16, textAlign: "center", color: resCol, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{gm.result}</span>}
                  {gm.opponentLogo && <img src={gm.opponentLogo} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ color: COLORS.textMuted, fontWeight: 700 }}>{gm.home ? "" : "@"}</span>{locTeam(gm.opponent, t)}</span>
                  <span style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{gm.score}</span>
                  {gm.rating != null ? <RatingBadge rating={gm.rating} style={{ minWidth: 0, padding: "1px 6px" }} /> : <span style={{ color: COLORS.textMuted, fontSize: 11, flexShrink: 0, width: 26, textAlign: "center" }}>–</span>}
                </div>;
              })}
            </div>}

            <div style={{ marginBottom: 18 }}>
              {pd.nationality && <StatRow label={t.plNationality} value={pd.nationality} />}
              {pd.age != null && <StatRow label={t.plAge} value={pd.age} />}
              {pd.position && <StatRow label={t.plPosition} value={pd.position} />}
            </div>

            {pd.competitions && pd.competitions.length > 0 && <div style={{ marginBottom: 18 }}>
              <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.plCompetitions}</div>
              {pd.competitions.map(function(c, i){
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", marginBottom: 6,
                  background: COLORS.card, borderRadius: 12, border: "none" }}>
                  {c.leagueLogo && <img src={c.leagueLogo} alt="" style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />}
                  <span style={{ flex: 1, color: COLORS.textPrimary, fontSize: 12, fontWeight: 600, minWidth: 0,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.league}</span>
                  <span style={{ color: COLORS.textSecondary, fontSize: 11, flexShrink: 0 }}>{c.appearances} {t.plApps}</span>
                  <span style={{ color: COLORS.accent, fontSize: 12, fontWeight: 800, minWidth: 64, textAlign: "right", flexShrink: 0 }}>
                    {c.goals}{t.plGoals[0]} {c.assists}{t.plAssists[0]}</span>
                  {c.rating != null && <RatingBadge rating={c.rating} style={{ minWidth: 0, padding: "1px 5px" }} />}
                </div>;
              })}
            </div>}

            {pd.trophies && pd.trophies.length > 0 && <div>
              <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.plTrophies}</div>
              {pd.trophies.map(function(tr, i){
                var won = (tr.place || "").toLowerCase() === "winner";
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", marginBottom: 5,
                  background: COLORS.card, borderRadius: 12, border: "none" }}>
                  <span style={{ fontSize: 14, flexShrink: 0, opacity: won ? 1 : 0.4 }}>🏆</span>
                  <span style={{ flex: 1, color: COLORS.textPrimary, fontSize: 12, fontWeight: won ? 700 : 500, minWidth: 0,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr.league}</span>
                  <span style={{ color: COLORS.textMuted, fontSize: 11, flexShrink: 0 }}>{tr.season}</span>
                  <span style={{ color: won ? COLORS.accent : COLORS.textSecondary, fontSize: 11, fontWeight: 700, minWidth: 56, textAlign: "right", flexShrink: 0 }}>
                    {won ? t.plWinner : tr.place}</span>
                </div>;
              })}
            </div>}
          </div>}
      </div>
    </div>
  </div>;
}

// Team profile page (info + venue + season stats + rank + fixtures). In-page overlay like MatchModal.
function TeamModal({ team, t, onClose, onOpenMatch }) {
  var [visible, setVisible] = useState(false);
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);

  useEffect(function(){
    var r = requestAnimationFrame(function(){ setVisible(true); });
    var prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e){ if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    fetch("/api/football?mode=team&id=" + team.id + "&season=2025")
      .then(function(r){ return r.json(); })
      .then(function(j){ setData(j.team || null); setLoading(false); })
      .catch(function(){ setData(null); setLoading(false); });
    return function(){
      cancelAnimationFrame(r);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  function handleClose() { setVisible(false); setTimeout(onClose, 360); }
  var drag = useSheetDrag(handleClose);

  var td = data;
  var st = (td && td.stats) || null;
  var logo = (td && td.logo) || team.logo;
  var name = (td && td.name) || team.name;

  function statCard(label, value, accent) {
    return <div style={{ flex: 1, minWidth: 0, background: COLORS.card, border: "none",
      borderRadius: 14, padding: "12px 8px", textAlign: "center" }}>
      <div style={{ color: accent === true ? COLORS.accent : (accent || COLORS.textPrimary), fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 3 }}>{label}</div>
    </div>;
  }

  return <div onClick={handleClose} style={{ position: "fixed", inset: 0, zIndex: 1000,
    display: "flex", justifyContent: "center", alignItems: "flex-end",
    background: visible ? "rgba(12,14,18,0.5)" : "rgba(12,14,18,0)",
    transition: "background 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} className="mo-scroll mo-matchsheet"
      onTouchStart={drag.handlers.onTouchStart} onTouchMove={drag.handlers.onTouchMove} onTouchEnd={drag.handlers.onTouchEnd} style={{
      width: "100%", maxWidth: 720, overflowY: "auto", overflowX: "hidden", fontFamily: FONT,
      WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", borderTopLeftRadius: 28, borderTopRightRadius: 28,
      background: "var(--modalGrad)",
      backdropFilter: "blur(22px) saturate(160%)", WebkitBackdropFilter: "blur(22px) saturate(160%)",
      border: "1px solid var(--modalBorder)",
      transform: visible ? ("translate3d(0," + drag.dragY + "px,0)") : "translate3d(0,100%,0)",
      transition: drag.dragging ? "none" : "transform 0.4s cubic-bezier(0.22,1,0.36,1)",
      willChange: "transform", WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>

      {/* header */}
      <div className="mo-sticky" style={{ zIndex: 5, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        background: "linear-gradient(180deg, rgba(106,69,230,0.16), rgba(106,69,230,0.06))",
        backdropFilter: "blur(18px) saturate(160%)", WebkitBackdropFilter: "blur(18px) saturate(160%)",
        borderBottom: "1px solid rgba(106,69,230,0.18)", padding: "max(16px, env(safe-area-inset-top)) 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textSecondary }}>{t.tmProfile}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {team && team.id != null && <FavButton kind="team" refId={team.id} name={name} image={logo} size={34} />}
            <button onClick={handleClose} aria-label="close" style={{ width: 36, height: 36, borderRadius: 12,
              border: "1px solid rgba(106,69,230,0.25)", background: "rgba(255,255,255,0.6)", cursor: "pointer", color: COLORS.textPrimary,
              fontSize: 18, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
              WebkitTapHighlightColor: "transparent" }}>×</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <TeamLogo src={logo} name={name} size={58} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: 800,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(name, t)}</div>
            <div style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4 }}>
              {[td && td.country, (td && td.founded) ? t.founded + " " + td.founded : null].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 18px max(40px, env(safe-area-inset-bottom))" }}>
        {loading ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>{t.loading}</div>
         : !td ? <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "40px 0" }}>{t.noResults}</div>
         : <div>
            {/* league + rank */}
            {td.league && <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14,
              background: COLORS.card, border: "none", borderRadius: 14, padding: "11px 13px" }}>
              {td.league.logo && <img src={td.league.logo} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />}
              <span style={{ flex: 1, color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, minWidth: 0,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{td.league.name}</span>
              {td.league.rank != null && <span style={{ color: COLORS.accent, fontSize: 13, fontWeight: 800 }}>{td.league.rank}. · {td.league.points != null ? td.league.points : 0}{t.points}</span>}
            </div>}

            {/* form */}
            {st && st.form && st.form.length > 0 && <div style={{ marginBottom: 14 }}>
              <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.formLabel}</div>
              <div>{st.form.map(function(f, i){ return <FormBadge key={i} result={f} />; })}</div>
            </div>}

            {/* season stat cards */}
            {st && <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {statCard(t.matchesPlayed, st.played != null ? st.played : "-")}
                {statCard(t.wins, st.wins, true)}
                {statCard(t.draws, st.draws)}
                {statCard(t.loses, st.loses)}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                {statCard(t.gFor, st.goalsFor, true)}
                {statCard(t.gAgainst, st.goalsAgainst)}
                {statCard(t.cleanSheets, st.cleanSheets)}
              </div>
            </div>}

            {/* venue */}
            {td.venue && (td.venue.name || td.venue.city) && <div style={{ marginBottom: 18 }}>
              {td.venue.name && <StatRow label={t.stadium} value={td.venue.name} />}
              {td.venue.city && <StatRow label={t.city} value={td.venue.city} />}
              {td.venue.capacity && <StatRow label={t.capacity} value={td.venue.capacity.toLocaleString()} />}
            </div>}

            {/* fixtures */}
            {td.fixtures && td.fixtures.length > 0 && <div>
              <div style={{ color: COLORS.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t.matches}</div>
              <div style={{ background: COLORS.card, borderRadius: 16, border: "none", padding: 6 }}>
                {td.fixtures.map(function(m, i){ return <MatchRow key={m.id} match={m} isF1={false} t={t}
                  divider={i < td.fixtures.length - 1} onOpen={function(){ if (onOpenMatch) onOpenMatch(m); }} />; })}
              </div>
            </div>}
          </div>}
      </div>
    </div>
  </div>;
}

function LangSwitch({ lang, setLang }) {
  var langs = [{ id: "tr", label: "TR" }, { id: "en", label: "EN" }, { id: "de", label: "DE" }];
  return <div style={{ display: "inline-flex", background: COLORS.cardAlt, borderRadius: 12, padding: 3, border: "none" }}>
    {langs.map(function(l){ var a = lang === l.id;
      return <button key={l.id} onClick={function(){ setLang(l.id); }} style={{ border: "none",
        background: a ? COLORS.accent : "transparent", color: a ? "#fff" : COLORS.textSecondary, borderRadius: 9,
        padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", fontFamily: FONT }}>{l.label}</button>; })}
  </div>;
}

// Logo slot top-left: theme-aware (logo_dark.PNG in dark, logo_light.PNG in light); clickable -> home. Falls back to wordmark.
function Logo({ theme, onHome }) {
  var [ok, setOk] = useState(true);
  var [iconOk, setIconOk] = useState(true);
  useEffect(function(){ setOk(true); setIconOk(true); }, [theme]); // re-try images when theme (src) changes
  var src = theme === "dark" ? "/logo_dark.PNG" : "/logo_light.PNG";
  var iconSrc = theme === "dark" ? "/logo-dark.png" : "/logo-light.png";
  return <div onClick={onHome} role="button" aria-label="home"
    style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
    {iconOk && <img key={"icon" + theme} className="mo-logoicon" src={iconSrc} alt="" onError={function(){ setIconOk(false); }}
      style={{ width: "auto", objectFit: "contain" }} />}
    {ok && <img key={theme} className="mo-logoimg" src={src} alt="fikstür" onError={function(){ setOk(false); }}
      style={{ width: "auto", objectFit: "contain" }} />}
    {!ok && <span style={{ color: COLORS.textPrimary, fontSize: 22, fontWeight: 800, letterSpacing: "-0.8px" }}>
      match<span style={{ color: COLORS.accent }}>ours</span></span>}
  </div>;
}

// Generic full-page panel with a back button (settings, news, ...).
function SimplePage({ title, onBack, t, children }) {
  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: FONT }}>
    <div className="mo-sticky" style={{ zIndex: 10, background: COLORS.bg, borderBottom: "1px solid " + COLORS.border,
      paddingTop: "max(20px, env(safe-area-inset-top))" }}>
      <div className="mo-container" style={{ padding: "0 20px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} aria-label="back" className="mo-xbtn" style={{ width: 38, height: 38, borderRadius: 12,
          background: COLORS.card, border: "1px solid " + COLORS.border, cursor: "pointer", color: COLORS.textSecondary,
          display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <span style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: 800 }}>{title}</span>
      </div>
    </div>
    <div className="mo-container" style={{ padding: "20px 20px max(40px, env(safe-area-inset-bottom))" }}>{children}</div>
  </div>;
}

// Predictions hub: my coupons + reputation leaderboards (weekly / season / community leagues).
function PredictionsPage({ onBack, t, loggedIn, onLogin, onOpenMatch }) {
  var [tab, setTab] = useState("coupons"); // "coupons" | "board"
  var [mine, setMine] = useState(null);    // { items, points, played }
  var [loggedIds, setLoggedIds] = useState(null); // Set of match_ids the user has already logged
  var [scope, setScope] = useState("weekly"); // "weekly" | "season" | <leagueId>
  var [board, setBoard] = useState(null);
  var [uid, setUid] = useState(null);
  var [leagues, setLeagues] = useState([]);
  var [newName, setNewName] = useState("");
  var [joinCode, setJoinCode] = useState("");
  var [busy, setBusy] = useState(false);
  var [msg, setMsg] = useState(null);

  function loadLeagues(){ fetchMyPredLeagues().then(function(l){ setLeagues(l || []); }).catch(function(){}); }
  useEffect(function(){
    if (!loggedIn) return;
    getUserId().then(setUid).catch(function(){});
    // score any past-due unscored coupons first, then load mine
    fetch("/api/predict/score").catch(function(){}).finally(function(){
      fetchMyPredictions(60).then(function(r){ setMine(r || { items: [], points: 0, played: 0 }); }).catch(function(){ setMine({ items: [], points: 0, played: 0 }); });
    });
    fetchMyLogs(200).then(function(l){ setLoggedIds(new Set((l || []).map(function(x){ return String(x.match_id); }))); }).catch(function(){ setLoggedIds(new Set()); });
    loadLeagues();
  }, [loggedIn]);

  useEffect(function(){
    if (tab !== "board") return;
    setBoard(null);
    var weekly = scope === "weekly";
    var leagueId = (scope === "weekly" || scope === "season") ? null : scope;
    fetchPredLeaderboard({ weekly: weekly, leagueId: leagueId, limit: 100 }).then(function(r){ setBoard(r || []); }).catch(function(){ setBoard([]); });
  }, [tab, scope, loggedIn]);

  function deleteCoupon(row){
    deletePrediction(row.match_id).then(function(res){
      if (res && res.error) return;
      predInvalidate(row.match_id); // keep the feed's quick 1X2 in sync
      setMine(function(prev){
        if (!prev) return prev;
        var items = prev.items.filter(function(x){ return x.id !== row.id; });
        var points = 0, played = 0;
        items.forEach(function(x){ if (x.scored) { points += x.points || 0; played += 1; } });
        return { items: items, points: points, played: played };
      });
    });
  }
  function createLeague(){
    var n = newName.trim(); if (n.length < 2 || busy) return;
    setBusy(true); setMsg(null);
    createPredLeague(n).then(function(res){
      setBusy(false);
      if (res && res.data) { setNewName(""); loadLeagues(); setScope(res.data.id); setTab("board"); setMsg("Lig oluşturuldu · kod: " + res.data.code); }
      else setMsg("Oluşturulamadı.");
    });
  }
  function joinLeague(){
    var c = joinCode.trim(); if (c.length < 4 || busy) return;
    setBusy(true); setMsg(null);
    joinPredLeague(c).then(function(res){
      setBusy(false);
      if (res && res.data) { setJoinCode(""); loadLeagues(); setScope(res.data.id); setTab("board"); }
      else setMsg(res && res.error === "not_found" ? "Bu kodla lig bulunamadı." : "Katılınamadı.");
    });
  }

  if (!loggedIn) return <SimplePage title={t.navPredictions} onBack={onBack} t={t}>
    <div style={{ textAlign: "center", padding: "44px 0", color: COLORS.textMuted, fontSize: 13 }}>Tahmin yap, tuttukça itibar puanı kazan.
      <div style={{ marginTop: 14 }}><button onClick={onLogin} style={{ padding: "9px 18px", background: COLORS.accent, color: "#fff",
        border: "none", borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>{t.signInBtn}</button></div>
    </div>
  </SimplePage>;

  var label = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", margin: "18px 2px 8px" };
  function chip(id, text){
    var on = scope === id;
    return <button key={id} onClick={function(){ setScope(id); }} className={on ? undefined : "mo-lgchip"} style={{ flexShrink: 0, padding: "7px 13px", borderRadius: 11, cursor: "pointer", fontFamily: FONT,
      border: "1px solid " + (on ? COLORS.accent : COLORS.border), background: on ? COLORS.accent : "transparent",
      color: on ? "#fff" : COLORS.textSecondary, fontSize: 12, fontWeight: on ? 800 : 600, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{text}</button>;
  }

  return <SimplePage title={t.navPredictions} onBack={onBack} t={t}>
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {/* reputation banner */}
      <div style={{ borderRadius: 18, padding: "16px 18px", background: COLORS.glassPurple, border: "1px solid " + COLORS.glassBorder,
        display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: COLORS.accent, lineHeight: 1 }}>{mine ? mine.points : 0}</div>
        <div>
          <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 800 }}>İtibar Puanın</div>
          <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{mine ? mine.played : 0} maç puanlandı</div>
        </div>
      </div>

      <UnderlineTabs indicatorColor={COLORS.accent} active={tab} onChange={setTab}
        tabs={[{ id: "coupons", label: "Kuponlarım" }, { id: "board", label: "Liderlik" }]} />

      {tab === "coupons"
        ? (mine === null
            ? <SkeletonRows rows={4} avatar={false} />
            : mine.items.length === 0
              ? <EmptyState icon={<EmptyIcon name="coupon" />} title="Henüz kupon yok" hint="Bir maça gir, 1X2 + maçın adamı + oyuncu reytinglerini tahmin et; tuttukça itibar kazan." />
              : <div>
                  {/* loop-closer: predicted matches that finished but you haven't logged yet */}
                  {(function(){
                    if (!loggedIds) return null;
                    var pending = mine.items.filter(function(x){ return x.scored && !loggedIds.has(String(x.match_id)); });
                    if (!pending.length) return null;
                    return <div style={{ marginBottom: 18 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 2px 8px" }}>
                        <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em" }}>Loglamayı bekliyor</span>
                        <span style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 700 }}>{pending.length}</span>
                      </div>
                      <div style={{ background: COLORS.glassPurple, border: "1px solid " + COLORS.glassBorder, borderRadius: 16, overflow: "hidden" }}>
                        {pending.slice(0, 6).map(function(row, i){
                          var m = row.meta || {};
                          return <div key={row.id} onClick={function(){ if (onOpenMatch) onOpenMatch(row.meta || { id: row.match_id }); }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer", borderTop: i ? "1px solid " + COLORS.glassBorder : "none", WebkitTapHighlightColor: "transparent" }}>
                            <TeamLogo src={m.homeLogo} name={m.home} size={18} />
                            <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(m.home, t)} - {locTeam(m.away, t)}</span>
                            <span style={{ flexShrink: 0, padding: "5px 13px", borderRadius: 999, background: COLORS.accent, color: "#fff", fontSize: 12, fontWeight: 800 }}>Logla</span>
                          </div>;
                        })}
                      </div>
                    </div>;
                  })()}
                  {mine.items.map(function(row){ return <CouponRow key={row.id} row={row} t={t} onOpen={function(){ if (onOpenMatch) onOpenMatch(row.meta || { id: row.match_id }); }} onDelete={function(){ deleteCoupon(row); }} />; })}
                </div>)
        : <div>
            {/* scope chips: weekly / season / my leagues */}
            <div className="mo-scroll" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
              {chip("weekly", "Haftalık")}
              {chip("season", "Sezon")}
              {leagues.map(function(l){ return chip(l.id, l.name); })}
            </div>
            {board === null
              ? <SkeletonRows rows={6} avatar={false} />
              : board.length === 0
                ? <EmptyState icon={<EmptyIcon name="trophy" />} title="Sıralama henüz boş" hint="Maçlar bitip kuponlar puanlandıkça liderlik burada oluşur." />
                : <div>{board.map(function(r, i){
                    var me = uid && String(r.user_id) === String(uid);
                    return <div key={r.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, marginBottom: 4,
                      background: me ? COLORS.accentDim : "transparent" }}>
                      <span style={{ width: 26, textAlign: "center", color: i < 3 ? COLORS.accent : COLORS.textMuted, fontSize: 14, fontWeight: 800 }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, color: COLORS.textPrimary, fontSize: 14, fontWeight: me ? 800 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.username}{me ? " (sen)" : ""}</span>
                      <span style={{ color: COLORS.textMuted, fontSize: 11 }}>{r.played} maç</span>
                      <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800, minWidth: 40, textAlign: "right" }}>{r.points}</span>
                    </div>; })}</div>}

            {/* community leagues: create + join */}
            <div style={label}>Topluluk Ligi</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={newName} onChange={function(e){ setNewName(e.target.value); }} placeholder="Lig adı"
                style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 11, border: "1px solid " + COLORS.border, background: COLORS.card, color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT }} />
              <button onClick={createLeague} disabled={busy} style={{ padding: "9px 14px", borderRadius: 11, border: "none", background: COLORS.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, flexShrink: 0 }}>Oluştur</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={joinCode} onChange={function(e){ setJoinCode(e.target.value.toUpperCase()); }} placeholder="Katılım kodu"
                style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 11, border: "1px solid " + COLORS.border, background: COLORS.card, color: COLORS.textPrimary, fontSize: 13, outline: "none", fontFamily: FONT, letterSpacing: "1px" }} />
              <button onClick={joinLeague} disabled={busy} style={{ padding: "9px 14px", borderRadius: 11, border: "1px solid " + COLORS.border, background: COLORS.card, color: COLORS.textPrimary, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, flexShrink: 0 }}>Katıl</button>
            </div>
            {msg && <div style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 8 }}>{msg}</div>}
          </div>}
    </div>
  </SimplePage>;
}

// One saved coupon row in the predictions hub.
function CouponRow({ row, t, onOpen, onDelete }) {
  var m = row.meta || {};
  var picks = row.picks || {};
  // cancellable only before kickoff (once the match starts the coupon is locked into your reputation)
  var canDelete = row.match_ts ? new Date(row.match_ts).getTime() > Date.now() : !row.scored;
  var res = picks.onextwo === "1" ? "MS 1" : picks.onextwo === "2" ? "MS 2" : picks.onextwo === "X" ? "MS X" : null;
  var bits = [];
  if (res) bits.push(res);
  if (picks.motm) bits.push("MA: " + (picks.motm.name || "").split(" ").slice(-1)[0]);
  if (picks.ratings && picks.ratings.length) bits.push(picks.ratings.length + " reyting");
  return <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 8px", borderBottom: "1px solid " + COLORS.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <TeamLogo src={m.homeLogo} name={m.home} size={18} />
        <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{locTeam(m.home, t)}</span>
        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>-</span>
        <TeamLogo src={m.awayLogo} name={m.away} size={18} />
        <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{locTeam(m.away, t)}</span>
      </div>
      <div style={{ color: COLORS.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bits.join(" · ")}</div>
    </div>
    {row.scored
      ? <span style={{ color: COLORS.accent, fontSize: 15, fontWeight: 800, flexShrink: 0 }}>+{row.points || 0}</span>
      : <span style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>bekliyor</span>}
    {canDelete && onDelete && <button onClick={function(e){ e.stopPropagation(); onDelete(); }} aria-label="sil" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9,
      border: "none", background: "transparent", color: COLORS.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
    </button>}
  </div>;
}

// Football DNA: a small identity fingerprint from the user's ratings + predictions.
// Axes are derived from data we already store (no player-attribute metadata needed yet).
// Taste Graph — the EARNED identity: bipolar axes drawn from the user's own logs (style tags)
// and rating consensus. AI only holds the mirror; every mark is the resultant of the user's taps.
function FootballDNA({ t, userId }) {
  var [logs, setLogs] = useState(null);
  var [prof, setProf] = useState(null);
  useEffect(function(){
    var c = false;
    (userId ? fetchUserLogs(userId, 300) : fetchMyLogs(300)).then(function(l){ if (!c) setLogs(l || []); }).catch(function(){ if (!c) setLogs([]); });
    fetchUserRatingProfile(userId).then(function(p){ if (!c) setProf(p || { n: 0 }); }).catch(function(){ if (!c) setProf({ n: 0 }); });
    return function(){ c = true; };
  }, [userId]);
  if (logs === null || !prof) return <div style={{ background: COLORS.card, borderRadius: 18, border: "1px solid " + COLORS.border, padding: "16px" }}>
    {[0,1,2,3].map(function(i){ return <div key={i} style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><Skeleton w={70} h={11} /><Skeleton w={54} h={11} /></div>
      <Skeleton w={"100%"} h={8} r={6} />
    </div>; })}
  </div>;

  // aggregate the style-tag votes into the two aesthetic axes
  var vec = {}; STYLE_TAGS.forEach(function(x){ vec[x.id] = x.vec; });
  var es = 0, rl = 0, tc = 0;
  logs.forEach(function(l){ (l.tags || []).forEach(function(id){ var v = vec[id]; if (v) { es += v.est; rl += v.rol; tc++; } }); });
  var estV = tc ? es / tc : 0, rolV = tc ? rl / tc : 0;
  var n = prof.n || 0, absd = prof.avg_absdiff, diff = prof.avg_diff;

  if (logs.length === 0 && n < 3) {
    return <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border, lineHeight: 1.5 }}>
      Taste Graph'ın oluşuyor — biten maçları logla (puan + etiket + oyuncu). Grafiği AI değil, senin seçimlerin çizecek.</div>;
  }

  var kontra = absd != null ? Math.min(1, absd / 1.8) : 0; // 0 = konsensüs, 1 = kontrarian
  // Estetik/Pragmatik from the match style-tags you picked
  var aesth = 0, prag = 0;
  logs.forEach(function(l){ (l.tags || []).forEach(function(id){ var v = vec[id]; if (!v) return; if (v.est > 0.1) aesth++; if (v.est < -0.1) prag++; }); });
  var nz = function(cnt){ return tc ? Math.min(1, cnt / tc * 1.5) : 0; };
  // Hücum/Defans from the PLAYERS you actually rated (weighted by how high you rated them)
  var atkW = 0, defW = 0, totW = 0;
  logs.forEach(function(l){ (l.players || []).forEach(function(p){ var w = (p.rating != null ? Number(p.rating) : 6); totW += w;
    var ps = p.pos; if (ps === "F") atkW += w; else if (ps === "M") atkW += w * 0.5; else if (ps === "D" || ps === "G") defW += w; }); });
  var atkV = totW ? Math.min(1, atkW / totW * 1.3) : 0;
  var defV = totW ? Math.min(1, defW / totW * 1.3) : 0;
  // spokes ordered so related traits aren't adjacent → a readable fingerprint
  var traits = [
    { k: "Estetik",   v: nz(aesth) },
    { k: "Hücum",     v: atkV },
    { k: "Kontra",    v: n >= 3 ? kontra : 0 },
    { k: "Cömert",    v: (n >= 3 && diff != null) ? Math.max(0, Math.min(1, (diff + 2) / 4)) : 0 },
    { k: "Aktif",     v: Math.min(1, logs.length / 12) },
    { k: "Uyum",      v: n >= 3 ? (1 - kontra) : 0 },
    { k: "Defans",    v: defV },
    { k: "Pragmatik", v: nz(prag) },
  ];
  var top = traits.filter(function(x){ return x.v > 0.35; }).sort(function(a, b){ return b.v - a.v; }).slice(0, 3).map(function(x){ return x.k; });
  var phrase = top.length ? top.join(" · ") : "Kimliğin şekilleniyor";
  var kontraScore = n >= 3 ? Math.round(kontra * 100) : null;

  // radar geometry
  var N = traits.length, cx = 150, cy = 150, R = 84;
  function pt(i, r){ var a = -Math.PI / 2 + i * 2 * Math.PI / N; return [cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r]; }
  function ptStr(i, r){ var p = pt(i, r); return p[0].toFixed(1) + "," + p[1].toFixed(1); }
  var dataPoly = traits.map(function(x, i){ return ptStr(i, Math.max(0.02, x.v)); }).join(" ");

  return <div style={{ background: COLORS.card, borderRadius: 18, border: "1px solid " + COLORS.border, padding: "16px" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{phrase}</div>
        <div style={{ color: COLORS.textMuted, fontSize: 11.5, fontWeight: 700, marginTop: 3 }}>{logs.length} log · {n} oyuncu puanı</div>
      </div>
      {kontraScore != null && <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{ color: COLORS.accent, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{kontraScore}</div>
        <div style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: 700, marginTop: 3 }}>kontra skoru</div>
      </div>}
    </div>
    <svg viewBox="0 0 300 300" width="100%" style={{ display: "block", maxWidth: 330, margin: "0 auto" }}>
      {[0.25, 0.5, 0.75, 1].map(function(rl, ri){
        return <polygon key={ri} points={traits.map(function(x, i){ return ptStr(i, rl); }).join(" ")} strokeWidth="1" style={{ fill: "none", stroke: COLORS.border }} />;
      })}
      {traits.map(function(x, i){ var e = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={e[0]} y2={e[1]} strokeWidth="1" style={{ stroke: COLORS.border }} />; })}
      <polygon points={dataPoly} strokeWidth="2" strokeLinejoin="round" style={{ fill: COLORS.accent, fillOpacity: 0.22, stroke: COLORS.accent }} />
      {traits.map(function(x, i){ var p = pt(i, Math.max(0.02, x.v)); return <circle key={i} cx={p[0]} cy={p[1]} r="2.8" style={{ fill: COLORS.accent }} />; })}
      {traits.map(function(x, i){
        var p = pt(i, 1.17); var anchor = p[0] < cx - 6 ? "end" : (p[0] > cx + 6 ? "start" : "middle");
        return <text key={i} x={p[0]} y={p[1]} textAnchor={anchor} dominantBaseline="middle"
          style={{ fill: x.v > 0.35 ? COLORS.textPrimary : COLORS.textMuted, fontFamily: FONT, fontSize: 10, fontWeight: x.v > 0.35 ? 800 : 700 }}>{x.k}</text>;
      })}
    </svg>
  </div>;
}

// Downscale + centre-crop an image file to a square JPEG blob — caps quality/size client-side.
function cropSquareBlob(file, size, quality) {
  return new Promise(function(resolve, reject){
    var img = new Image();
    img.onload = function(){
      var s = Math.min(img.naturalWidth, img.naturalHeight);
      var sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
      var cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      var ctx = cv.getContext("2d");
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      cv.toBlob(function(b){ try { URL.revokeObjectURL(img.src); } catch (e) {} b ? resolve(b) : reject(new Error("blob")); }, "image/jpeg", quality);
    };
    img.onerror = function(){ reject(new Error("img")); };
    img.src = URL.createObjectURL(file);
  });
}

function ProfilePage({ onBack, onLogout, session, t, lang, setLang, onOpenTeam, onOpenPlayer }) {
  useFavorites();
  var favRecs = Object.keys(FAV.map).map(function(k){ return FAV.map[k]; });
  var favTeams = favRecs.filter(function(r){ return r.kind === "team"; });
  var favPlayers = favRecs.filter(function(r){ return r.kind === "player"; });
  var [my, setMy] = useState({ count: 0, items: [] });
  var [logs, setLogs] = useState(null);
  var [scout, setScout] = useState(null); // most-analysed players
  var [act, setAct] = useState("logs"); // activities toggle: "logs" | "comments"
  var [logView, setLogView] = useState(null); // a log row opened in the detail sheet
  var [username, setUsername] = useState(null);
  var [avatar, setAvatar] = useState(null);
  var [avaBusy, setAvaBusy] = useState(false);
  var avatarInput = useRef(null);
  var [editing, setEditing] = useState(false);
  var [draft, setDraft] = useState("");
  var [savingName, setSavingName] = useState(false);
  function onPickAvatar(e){
    var f = e.target.files && e.target.files[0]; if (!f) return; setAvaBusy(true);
    cropSquareBlob(f, 400, 0.82).then(function(blob){ return uploadAvatar(blob); })
      .then(function(res){ setAvaBusy(false); if (res && res.url) setAvatar(res.url); })
      .catch(function(){ setAvaBusy(false); });
  }
  useEffect(function(){
    var cancelled = false;
    fetchMyComments(20).then(function(res){ if (!cancelled) setMy(res || { count: 0, items: [] }); }).catch(function(){});
    fetchMyLogs(40).then(function(res){ return backfillLogLogos(res || []); }).then(function(res){ if (!cancelled) setLogs(res); }).catch(function(){ if (!cancelled) setLogs([]); });
    fetchMyRatedPlayers(24).then(function(res){ if (!cancelled) setScout(res || []); }).catch(function(){ if (!cancelled) setScout([]); });
    fetchMyUsername().then(function(u){ if (!cancelled && u) setUsername(u); }).catch(function(){});
    fetchMyAvatar().then(function(u){ if (!cancelled && u) setAvatar(u); }).catch(function(){});
    return function(){ cancelled = true; };
  }, []);
  var userEmail = (session && session.user && session.user.email) || "";
  var name = username || (userEmail ? userEmail.split("@")[0] : "user");
  var initial = name ? name[0].toUpperCase() : "U";
  function startEdit(){ setDraft(username || ""); setEditing(true); }
  function saveName(){
    var v = draft.trim(); if (v.length < 2) return;
    setSavingName(true);
    updateUsername(v).then(function(res){ if (!res || !res.error) setUsername(v); setEditing(false); setSavingName(false); });
  }
  var createdAt = session && session.user && session.user.created_at;
  var locale = lang === "tr" ? "tr-TR" : (lang === "de" ? "de-DE" : "en-US");
  var memberSince = createdAt ? new Date(createdAt).toLocaleDateString(locale, { month: "short", year: "numeric" }) : "—";
  var stats = [
    { label: t.teamTag, val: favTeams.length },
    { label: t.playerTag, val: favPlayers.length },
    { label: t.commentsCount, val: my.count },
    { label: t.membership, val: memberSince },
  ];
  var sectionLabel = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 12 };

  function favStrip(list, kind) {
    return <div className="mo-scroll" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
      {list.map(function(r){
        return <div key={r.kind + r.ref_id} onClick={function(){ if (kind === "team") { if (onOpenTeam) onOpenTeam(r); } else { if (onOpenPlayer) onOpenPlayer(r); } }}
          style={{ flexShrink: 0, width: 66, cursor: "pointer", textAlign: "center", WebkitTapHighlightColor: "transparent" }}>
          <div style={{ width: 62, height: 62, borderRadius: "50%", margin: "0 auto 6px", background: COLORS.card,
            border: "1px solid " + COLORS.border, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {r.image
              ? (kind === "team"
                  ? <img src={r.image} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
                  : <img src={r.image} alt="" style={{ width: 62, height: 62, objectFit: "cover", borderRadius: "50%" }} />)
              : <span style={{ color: COLORS.textMuted, fontSize: 20, fontWeight: 800 }}>{(r.name || "?")[0]}</span>}
          </div>
          <div style={{ color: COLORS.textSecondary, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{locTeam(r.name, t)}</div>
        </div>; })}
    </div>;
  }

  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: FONT }}>
    <div style={{ maxWidth: 560, margin: "0 auto", width: "100%",
      paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      {/* top bar */}
      <div className="mo-sticky" style={{ padding: "max(20px, env(safe-area-inset-top)) 20px 14px", zIndex: 10, background: COLORS.bg,
        borderBottom: "1px solid " + COLORS.border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} aria-label="back" className="mo-xbtn" style={{ width: 38, height: 38, borderRadius: 12, background: COLORS.card,
            border: "1px solid " + COLORS.border, cursor: "pointer", color: COLORS.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <span style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: 800 }}>{t.profile}</span></div>
        <LangSwitch lang={lang} setLang={setLang} />
      </div>

      {/* hero: avatar + identity. Flat — the gradient avatar is the single color moment. */}
      <div style={{ position: "relative", padding: "26px 20px 22px" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 16 }}>
          <input ref={avatarInput} type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
          <div onClick={function(){ if (avatarInput.current) avatarInput.current.click(); }} style={{ position: "relative", width: 72, height: 72, flexShrink: 0, cursor: "pointer", opacity: avaBusy ? 0.6 : 1, WebkitTapHighlightColor: "transparent" }}>
            {avatar
              ? <img src={avatar} alt="" style={{ width: 72, height: 72, borderRadius: 24, objectFit: "cover", display: "block" }} />
              : <div style={{ width: 72, height: 72, borderRadius: 24, background: "linear-gradient(135deg, " + COLORS.accent + ", " + COLORS.teal + ")",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#fff" }}>{initial}</div>}
            <span style={{ position: "absolute", bottom: -3, right: -3, width: 24, height: 24, borderRadius: 999, background: COLORS.accent, border: "2px solid " + COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.2" /></svg>
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {editing
              ? <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <input value={draft} autoFocus maxLength={24} onChange={function(e){ setDraft(e.target.value); }}
                    onKeyDown={function(e){ if (e.key === "Enter") saveName(); }}
                    style={{ flex: 1, minWidth: 0, padding: "7px 12px", background: COLORS.card, border: "1px solid " + COLORS.border,
                      borderRadius: 12, color: COLORS.textPrimary, fontSize: 16, fontWeight: 700, outline: "none", fontFamily: FONT }} />
                  <button onClick={saveName} disabled={savingName} style={{ padding: "8px 14px", background: COLORS.accent, color: "#fff",
                    border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT, flexShrink: 0 }}>{t.save}</button>
                </div>
              : <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ color: COLORS.textPrimary, fontSize: 21, fontWeight: 800,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{name}</span>
                  <button onClick={startEdit} aria-label={t.username} style={{ width: 28, height: 28, borderRadius: 8, border: "none",
                    background: "transparent", cursor: "pointer", color: COLORS.textMuted, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                </div>}
            <div style={{ color: COLORS.textSecondary, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userEmail}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 20px 60px" }}>
        {/* stats: single card, 4 columns with dividers */}
        <div style={{ display: "flex", background: COLORS.card, borderRadius: 18, border: "1px solid " + COLORS.border, padding: "16px 6px", marginBottom: 24 }}>
          {stats.map(function(st, i){ return <div key={i} style={{ flex: 1, textAlign: "center", minWidth: 0, padding: "0 4px",
            borderLeft: i ? "1px solid " + COLORS.border : "none" }}>
            <div style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: 800, marginBottom: 3,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.val}</div>
            <div style={{ color: COLORS.textMuted, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.label}</div></div>; })}
        </div>

        {/* Football DNA — your rating/prediction fingerprint */}
        <div style={{ marginBottom: 22 }}><div style={sectionLabel}>Taste Graph</div><FootballDNA t={t} /></div>

        {/* Passport: collections earned from logs (stadiums attended, competitions, teams) */}
        {(function(){
          var lg = logs || [];
          if (lg.length === 0) return null;
          var venues = {}, comps = {}, teams = {};
          lg.forEach(function(g){ if (g.attended && g.venue) venues[g.venue] = 1; if (g.league) comps[g.league] = 1; if (g.home) teams[locTeam(g.home, t)] = 1; if (g.away) teams[locTeam(g.away, t)] = 1; });
          var stadiums = Object.keys(venues);
          var cols = [{ n: stadiums.length, l: "Stadyum" }, { n: Object.keys(comps).length, l: "Turnuva" }, { n: Object.keys(teams).length, l: "Takım" }];
          return <div style={{ marginBottom: 22 }}>
            <div style={sectionLabel}>Pasaport</div>
            <div style={{ background: COLORS.card, border: "1px solid " + COLORS.border, borderRadius: 18, padding: "16px 6px" }}>
              <div style={{ display: "flex" }}>
                {cols.map(function(c, i){ return <div key={i} style={{ flex: 1, textAlign: "center", borderLeft: i ? "1px solid " + COLORS.border : "none" }}>
                  <div style={{ color: COLORS.accent, fontSize: 20, fontWeight: 800 }}>{c.n}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 3 }}>{c.l}</div>
                </div>; })}
              </div>
              {stadiums.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "14px 10px 2px" }}>
                {stadiums.slice(0, 14).map(function(v, i){ return <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 999, background: COLORS.accentDim, color: COLORS.accent, fontSize: 11, fontWeight: 700 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                  {v}</span>; })}
              </div>}
            </div>
          </div>;
        })()}

        {/* Scout: players you've analysed most (from your ratings) */}
        {scout && scout.length > 0 && <div style={{ marginBottom: 22 }}>
          <div style={sectionLabel}>Scout · en çok analiz</div>
          <div className="mo-scroll" style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
            {scout.map(function(p){
              var photo = "https://media.api-sports.io/football/players/" + p.id + ".png";
              return <div key={p.id} onClick={function(){ if (onOpenPlayer) onOpenPlayer({ ref_id: p.id, name: p.name, image: photo }); }}
                style={{ flexShrink: 0, width: 72, cursor: "pointer", textAlign: "center", WebkitTapHighlightColor: "transparent" }}>
                <div style={{ position: "relative", width: 60, height: 60, margin: "0 auto 6px" }}>
                  <img src={photo} alt="" onError={function(e){ e.currentTarget.style.visibility = "hidden"; }}
                    style={{ width: 60, height: 60, borderRadius: "50%", objectFit: "cover", background: COLORS.cardAlt, border: "1px solid " + COLORS.border }} />
                  <RatingBadge rating={p.avg} style={{ position: "absolute", bottom: -4, left: "50%", transform: "translateX(-50%)", fontSize: 10, minWidth: 0, padding: "1px 6px", borderRadius: 6 }} />
                </div>
                <div style={{ color: COLORS.textSecondary, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lastName(p.name)}</div>
                <div style={{ color: COLORS.accent, fontSize: 10, fontWeight: 800, marginTop: 1 }}>{p.n} analiz</div>
              </div>; })}
          </div>
        </div>}

        {/* favorites */}
        {favTeams.length > 0 && <div style={{ marginBottom: 22 }}><div style={sectionLabel}>{t.favTeams}</div>{favStrip(favTeams, "team")}</div>}
        {favPlayers.length > 0 && <div style={{ marginBottom: 22 }}><div style={sectionLabel}>{t.favPlayers}</div>{favStrip(favPlayers, "player")}</div>}
        {favRecs.length === 0 && <div style={{ marginBottom: 22 }}>
          <div style={sectionLabel}>{t.favTeams}</div>
          <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16 }}>{t.noFavorites}</div>
        </div>}

        {/* Activities: comments + logs behind one toggle */}
        <div style={{ marginBottom: 8 }}>
          <div style={sectionLabel}>Aktiviteler</div>
          <UnderlineTabs indicatorColor={COLORS.accent} active={act} onChange={setAct}
            tabs={[{ id: "logs", label: "Loglar" }, { id: "comments", label: "Yorumlar" }]} />
          <div style={{ marginTop: 12 }}>
            {act === "comments"
              ? (my.items.length > 0
                  ? my.items.map(function(c){
                      var isPl = c.target_type === "player";
                      var ctx = c.match_name || c.target_name || "";
                      return <div key={c.id} style={{ padding: "12px 14px", marginBottom: 8, background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>
                        <div style={{ color: COLORS.textPrimary, fontSize: 13, lineHeight: 1.45, marginBottom: ctx ? 7 : 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
                        {ctx && <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: COLORS.textMuted }}>
                          <span style={{ fontWeight: 800, color: COLORS.accent }}>{isPl ? t.playerTag : t.matchTag}</span>
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{ctx}</span>
                          <span style={{ marginLeft: "auto", flexShrink: 0 }}>{relTime(c.created_at, lang)}</span>
                        </div>}
                      </div>; })
                  : <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>Henüz yorum yok.</div>)
              : (logs === null
                  ? <SkeletonRows rows={4} card={false} />
                  : logs.length > 0
                    ? logs.map(function(g){ return <LogCard key={g.id} g={g} t={t} lang={lang} onClick={function(){ setLogView(g); }} />; })
                    : <div style={{ color: COLORS.textMuted, fontSize: 13, padding: "14px", background: COLORS.card, borderRadius: 16, border: "1px solid " + COLORS.border }}>Henüz log yok — biten bir maça girip logla.</div>)}
          </div>
        </div>

        {logView && <RatingDetailSheet
          match={{ id: logView.match_id, home: logView.home, away: logView.away, homeLogo: logView.home_logo, awayLogo: logView.away_logo, score: logView.score }}
          log={{ userId: (session && session.user && session.user.id), own: true, rating: Number(logView.rating), tags: logView.tags, attended: logView.attended, venue: logView.venue, photo: logView.photo }}
          t={t}
          onClose={function(){ setLogView(null); }}
          onDelete={function(){ return deleteMatchLog(logView.match_id).then(function(){ setLogs(function(cur){ return (cur || []).filter(function(x){ return x.id !== logView.id; }); }); }); }} />}

        <button onClick={onLogout} style={{ width: "100%", marginTop: 20, padding: 14, background: "transparent",
          border: "1px solid " + COLORS.red + "55", borderRadius: 16, color: COLORS.red, fontSize: 14,
          fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>{t.logout}</button>
      </div></div></div>;
}

function LoginScreen({ t, lang, setLang, theme, onClose }) {
  var [mode, setMode] = useState("login"); // "login" | "signup"
  var [logoOk, setLogoOk] = useState(true);
  var [showPass, setShowPass] = useState(false);
  var [email, setEmail] = useState("");
  var [pass, setPass] = useState("");
  var [username, setUsername] = useState("");
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [info, setInfo] = useState("");

  function go() {
    setError(""); setInfo("");
    if (!email || !pass) { setError(t.fillFields); return; }
    if (mode === "signup" && username.trim().length < 2) { setError(t.usernameHint); return; }
    setLoading(true);
    if (mode === "signup") {
      supabase.auth.signUp({ email: email, password: pass, options: { data: { username: username.trim() } } })
        .then(function(res){
          if (res.error) { setError(res.error.message); }
          else if (res.data && res.data.session) { /* auto signed in; onAuthStateChange handles it */ }
          else { setInfo(t.checkEmail); }
        })
        .catch(function(e){ setError(String(e)); })
        .finally(function(){ setLoading(false); });
    } else {
      supabase.auth.signInWithPassword({ email: email, password: pass })
        .then(function(res){ if (res.error) setError(res.error.message); })
        .catch(function(e){ setError(String(e)); })
        .finally(function(){ setLoading(false); });
    }
  }

  return <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT, position: "relative" }}>
    {onClose && <button onClick={onClose} aria-label="kapat" style={{ position: "absolute", top: "max(18px, env(safe-area-inset-top))", left: 18,
      width: 38, height: 38, borderRadius: 12, border: "none", background: COLORS.card, color: COLORS.textPrimary, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>}
    <div style={{ marginBottom: 40, textAlign: "center" }}>
      {logoOk
        ? <img key={theme} src={theme === "dark" ? "/logo_dark.PNG" : "/logo_light.PNG"} alt="fikstür.com"
            onError={function(){ setLogoOk(false); }}
            style={{ height: 62, width: "auto", objectFit: "contain", margin: "0 auto", display: "block" }} />
        : <h1 style={{ color: COLORS.textPrimary, fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: "-1px", fontFamily: FONT }}>
            match<span style={{ color: COLORS.accent }}>ours</span></h1>}
      <p style={{ color: COLORS.textSecondary, fontSize: 14, marginTop: 12 }}>{t.tagline}</p></div>

    <div style={{ width: "100%", maxWidth: 360 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: COLORS.cardAlt, borderRadius: 14,
        padding: 4, border: "none" }}>
        {[{ id: "login", label: t.login }, { id: "signup", label: t.signup }].map(function(m){ var a = mode === m.id;
          return <button key={m.id} onClick={function(){ setMode(m.id); setError(""); setInfo(""); }} style={{ flex: 1,
            border: "none", borderRadius: 11, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: a ? COLORS.accent : "transparent", color: a ? "#fff" : COLORS.textSecondary,
            transition: "all 0.2s", fontFamily: FONT }}>{m.label}</button>; })}
      </div>

      {mode === "signup" && <input placeholder={t.username} value={username} onChange={function(e){ setUsername(e.target.value); }}
        maxLength={24}
        style={{ width: "100%", padding: "14px 16px", background: COLORS.card, border: "none",
          borderRadius: 16, color: COLORS.textPrimary, fontSize: 15, outline: "none", marginBottom: 12, boxSizing: "border-box", fontFamily: FONT }} />}
      <input placeholder={t.email} value={email} onChange={function(e){ setEmail(e.target.value); }}
        style={{ width: "100%", padding: "14px 16px", background: COLORS.card, border: "none",
          borderRadius: 16, color: COLORS.textPrimary, fontSize: 15, outline: "none", marginBottom: 12, boxSizing: "border-box", fontFamily: FONT }} />
      <div style={{ position: "relative", marginBottom: 16 }}>
        <input placeholder={t.password} type={showPass ? "text" : "password"} value={pass} onChange={function(e){ setPass(e.target.value); }}
          onKeyDown={function(e){ if (e.key==="Enter") go(); }}
          style={{ width: "100%", padding: "14px 46px 14px 16px", background: COLORS.card, border: "none",
            borderRadius: 16, color: COLORS.textPrimary, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
        <button type="button" onClick={function(){ setShowPass(function(s){ return !s; }); }} aria-label="şifreyi göster/gizle"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 34, height: 34,
            display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none",
            cursor: "pointer", color: COLORS.textMuted, padding: 0, WebkitTapHighlightColor: "transparent" }}>
          {showPass
            ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
        </button>
      </div>

      {error && <div style={{ color: COLORS.red, fontSize: 12, marginBottom: 12, textAlign: "center" }}>{error}</div>}
      {info && <div style={{ color: COLORS.accent, fontSize: 12, marginBottom: 12, textAlign: "center" }}>{info}</div>}

      <button onClick={go} disabled={loading} style={{ width: "100%", padding: 14, background: loading ? COLORS.textMuted : COLORS.accent,
        border: "none", borderRadius: 16, color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: FONT }}>
        {loading ? t.loggingIn : (mode === "signup" ? t.signup : t.login)}</button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0" }}>
        <div style={{ flex: 1, height: 1, background: COLORS.border }} />
        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{lang === "tr" ? "veya" : (lang === "de" ? "oder" : "or")}</span>
        <div style={{ flex: 1, height: 1, background: COLORS.border }} />
      </div>
      {[{ id: "google", label: "Google", icon: <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 5.1 29.4 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 7.1 29.4 5 24 5 16.3 5 9.7 9.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.2 35.9 26.7 37 24 37c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.6 40.6 16.2 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C39.9 36.6 43 31 43 24c0-1.3-.1-2.3-.4-3.5z"/></svg> },
        { id: "apple", label: "Apple", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill={COLORS.textPrimary}><path d="M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.7 2.2 1.1 0 1.5-.7 2.8-.7s1.6.7 2.8.7c1.1 0 1.9-1.1 2.6-2.2.8-1.2 1.1-2.4 1.2-2.5-.1 0-2.3-.9-2.3-3.5zM14.2 6c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.5.6-1 1.6-.9 2.6 1 0 2-.5 2.6-1.2z"/></svg> }].map(function(pr){
        return <button key={pr.id} onClick={function(){ try { supabase.auth.signInWithOAuth({ provider: pr.id, options: { redirectTo: typeof window !== "undefined" ? window.location.origin : undefined } }); } catch (e) {} }}
          style={{ width: "100%", padding: 13, background: COLORS.card, border: "1px solid " + COLORS.border, borderRadius: 16,
            color: COLORS.textPrimary, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT, display: "flex",
            alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10, WebkitTapHighlightColor: "transparent" }}>
          {pr.icon}{lang === "tr" ? (pr.label + " ile devam et") : (lang === "de" ? ("Weiter mit " + pr.label) : ("Continue with " + pr.label))}
        </button>; })}
    </div></div>;
}

// Slide-in hamburger drawer: dark/light toggle, language, and links to settings / news.
function MenuDrawer({ onClose, theme, setTheme, lang, setLang, t, onSettings, onNews, onFavorites }) {
  var [show, setShow] = useState(false);
  useEffect(function(){
    var r = requestAnimationFrame(function(){ setShow(true); });
    var prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    function onKey(e){ if (e.key === "Escape") close(); }
    window.addEventListener("keydown", onKey);
    return function(){ cancelAnimationFrame(r); document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, []);
  function close(){ setShow(false); setTimeout(onClose, 300); }
  var card = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: COLORS.card, borderRadius: 14, marginBottom: 10 };
  var label = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", margin: "18px 2px 8px" };
  return <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 140, display: "flex", justifyContent: "flex-end",
    background: show ? "rgba(8,10,16,0.5)" : "rgba(8,10,16,0)", backdropFilter: show ? "blur(3px)" : "none", WebkitBackdropFilter: show ? "blur(3px)" : "none",
    transition: "background 0.3s ease, backdrop-filter 0.3s ease, -webkit-backdrop-filter 0.3s ease" }}>
    <div onClick={function(e){ e.stopPropagation(); }} style={{ width: "86%", maxWidth: 360, height: "100%", background: COLORS.bg, fontFamily: FONT,
      padding: "max(18px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))", overflowY: "auto", boxShadow: "-10px 0 44px rgba(0,0,0,0.34)",
      transform: show ? "translateX(0)" : "translateX(100%)", transition: "transform 0.34s cubic-bezier(0.22,1,0.36,1)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: COLORS.textPrimary, fontSize: 19, fontWeight: 800 }}>{t.menu}</span>
        <button onClick={close} aria-label="kapat" style={{ width: 36, height: 36, borderRadius: 11, border: "none", background: COLORS.card,
          color: COLORS.textPrimary, cursor: "pointer", fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>×</button>
      </div>
      <div style={label}>{t.appearance}</div>
      <div style={card}>
        <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>{t.darkMode}</span>
        <button onClick={function(){ setTheme(theme === "dark" ? "light" : "dark"); }} aria-label="toggle dark mode"
          style={{ width: 50, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
            background: theme === "dark" ? COLORS.accent : COLORS.border, transition: "background 0.3s ease", WebkitTapHighlightColor: "transparent" }}>
          <span style={{ position: "absolute", top: 3, left: theme === "dark" ? 25 : 3, width: 22, height: 22, borderRadius: "50%",
            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left 0.3s cubic-bezier(0.22,1,0.36,1)" }} />
        </button>
      </div>
      <div style={label}>{t.language}</div>
      <LangSwitch lang={lang} setLang={setLang} />
      <div style={{ height: 18 }} />
      {onFavorites && <button onClick={function(){ close(); setTimeout(onFavorites, 300); }} style={Object.assign({ width: "100%", border: "none", cursor: "pointer", fontFamily: FONT, marginBottom: 10 }, card)}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
          {t.favorites}</span>
        <span style={{ color: COLORS.textMuted, fontSize: 18 }}>›</span>
      </button>}
      <button onClick={function(){ close(); setTimeout(onSettings, 300); }} style={Object.assign({ width: "100%", border: "none", cursor: "pointer", fontFamily: FONT }, card)}>
        <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>{t.settings}</span>
        <span style={{ color: COLORS.textMuted, fontSize: 18 }}>›</span>
      </button>
    </div>
  </div>;
}

// Mobile-only bottom navigation (Instagram-style) with a single sliding indicator line.
// Bottom-nav items that use a custom image instead of the built-in SVG.
// Drop the files in /public; if missing, it falls back to the SVG.
var NAV_IMG = { mac: "/nav-mac.png", topluluk: "/community.png" };
var NAV_TINT = { mac: true, topluluk: true }; // recolor the shape (grey -> accent) like the SVG icons, instead of its own colors
// Recolor a transparent PNG via CSS mask: the shape is filled with `color` (defaults to current text color).
function MaskIcon({ src, size, color, style }) {
  return <span style={Object.assign({ width: size || 24, height: size || 24, display: "inline-block", flexShrink: 0, backgroundColor: color || "currentColor",
    WebkitMaskImage: "url(" + src + ")", maskImage: "url(" + src + ")", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
    WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskSize: "contain", maskSize: "contain" }, style || {})} />;
}
function NavIcon({ id, active, svg }) {
  var [imgOk, setImgOk] = useState(true);
  var src = NAV_IMG[id];
  if (src && NAV_TINT[id]) return <MaskIcon src={src} size={24} />; // grey when idle, accent when active (via button color)
  if (src && imgOk) {
    return <img src={src} alt="" onError={function(){ setImgOk(false); }}
      style={{ width: 24, height: 24, objectFit: "contain", opacity: active ? 1 : 0.5, transition: "opacity 0.2s" }} />;
  }
  return svg; // fallback: the default SVG icon
}

function MobileBottomNav({ active, onSelect, t }) {
  t = t || I18N.tr;
  var ref = useRef(null);
  var [ind, setInd] = useState({ left: 0, width: 0 });
  var items = [["mac", t.navMatch], ["arama", t.navSearch], ["topluluk", t.navCommunity], ["tahminler", t.navPredictions], ["profil", t.navProfile]];
  useEffect(function(){
    function measure(){
      var el = ref.current; if (!el) return;
      var idx = items.findIndex(function(x){ return x[0] === active; });
      var btn = idx >= 0 ? el.children[idx] : null;
      if (btn) setInd({ left: btn.offsetLeft + btn.offsetWidth * 0.28, width: btn.offsetWidth * 0.44 });
    }
    measure();
    var id = setTimeout(measure, 50);
    window.addEventListener("resize", measure);
    return function(){ clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [active]);
  function icon(id) {
    var p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", width: 22, height: 22, viewBox: "0 0 24 24" };
    if (id === "mac") return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m12 7 2.9 2.1-1.1 3.4h-3.6L9.1 9.1z" /></svg>;
    if (id === "arama") return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
    if (id === "topluluk") return <svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16.5 5.6a3 3 0 0 1 0 5.6M18.5 20c0-2-.7-3.6-2-4.6" /></svg>;
    if (id === "tahminler") return <svg {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
    return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>;
  }
  return <><style>{".mo-bottomnav{display:flex}@media(min-width:900px){.mo-bottomnav{display:none}}"}</style>
    <nav ref={ref} className="mo-bottomnav" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 95,
    background: COLORS.card, borderTop: "1px solid " + COLORS.border, boxShadow: "0 -2px 16px rgba(0,0,0,0.2)",
    paddingBottom: "env(safe-area-inset-bottom)" }}>
    {items.map(function(it){ var a = active === it[0];
      return <button key={it[0]} onClick={function(){ onSelect(it[0]); }} style={{ flex: 1, background: "transparent", border: "none",
        cursor: "pointer", padding: "8px 0 7px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
        color: a ? COLORS.accent : COLORS.textMuted, transition: "color 0.2s", fontFamily: FONT, WebkitTapHighlightColor: "transparent" }}>
        <NavIcon id={it[0]} active={a} svg={icon(it[0])} />
        <span style={{ fontSize: 10, fontWeight: a ? 700 : 600 }}>{it[1]}</span>
      </button>; })}
    <span aria-hidden style={{ position: "absolute", top: 0, height: 2.5, borderRadius: 3, background: COLORS.accent,
      left: ind.left, width: ind.width, opacity: ind.width ? 1 : 0,
      transition: "left 0.3s cubic-bezier(0.22,1,0.36,1), width 0.3s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease", pointerEvents: "none" }} />
  </nav></>;
}

// One forum post (Twitter-style): avatar, @username · time, body, and a quoted match/player card.
function CommentCard({ c, onOpenMatch, t, liveLookup }) {
  var name = c.user || "kullanıcı";
  var initial = (name && name[0]) ? name[0].toUpperCase() : "?";
  var isPlayer = c.target_type === "player";
  var meta = c.meta || null;
  var snap = isPlayer ? (meta && meta.match) : meta; // match snapshot stored at comment time
  // prefer the live version from the current feed so a live match isn't frozen at comment time
  var m = (liveLookup && snap && snap.id != null && liveLookup(snap.id)) || snap;
  var canOpen = !!(onOpenMatch && m && m.id != null);
  function open(){ if (canOpen) onOpenMatch(Object.assign({ stats: {} }, m)); }
  var quoteBase = { background: COLORS.card, borderRadius: 12, border: "1px solid " + COLORS.border,
    cursor: canOpen ? "pointer" : "default", WebkitTapHighlightColor: "transparent" };

  // match quote: logos/flags + score (no team text)
  function matchQuote() {
    if (!m) return <div style={Object.assign({ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }, quoteBase)}>
      <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.accent, background: COLORS.accentDim, padding: "2px 8px", borderRadius: 7 }}>{t.matchTag}</span>
      <span style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 600 }}>{c.target_name || t.matchTag}</span></div>;
    var showScore = m.score && (m.status === "live" || m.status === "finished");
    var nameStyle = { fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, textAlign: "center",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" };
    var sideStyle = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 };
    return <div onClick={open} style={Object.assign({ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 12, padding: "11px 12px" }, quoteBase)}>
      <div style={sideStyle}>
        <TeamLogo src={m.homeLogo} name={m.home} size={30} />
        <span style={nameStyle}>{locTeam(m.home, t)}</span>
      </div>
      <span style={{ flexShrink: 0, paddingTop: 7, minWidth: 50, textAlign: "center", fontSize: showScore ? 18 : 13, fontWeight: 800,
        color: showScore ? COLORS.textPrimary : COLORS.textSecondary }}>
        {showScore ? m.score : (m.time || m.date || "-")}
        {m.status === "live" && <span style={{ color: COLORS.red, fontSize: 10, marginLeft: 4, verticalAlign: "middle" }}>●</span>}
        {m.penScore && <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: COLORS.textSecondary, marginTop: 1 }}>Pen. {m.penScore}</span>}
      </span>
      <div style={sideStyle}>
        <TeamLogo src={m.awayLogo} name={m.away} size={30} />
        <span style={nameStyle}>{locTeam(m.away, t)}</span>
      </div>
    </div>;
  }

  // player quote: photo + name(+rating) + goals/assists/cards, with the match on the footer ("sap")
  function playerQuote() {
    var photo = (meta && meta.photo) || ("https://media.api-sports.io/football/players/" + c.target_id + ".png");
    var nm = (meta && meta.name) || c.target_name || t.playerTag;
    var g = meta && meta.goals, a = meta && meta.assists, y = meta && meta.yellow, rc = meta && meta.red;
    var hasStats = (g || a || y || rc);
    var footName = c.match_name || (m ? ((m.home || "") + " - " + (m.away || "")) : "");
    return <div onClick={open} style={Object.assign({ padding: "10px 12px" }, quoteBase)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src={photo} alt="" onError={function(e){ e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: COLORS.cardAlt }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{nm}</span>
            {meta && meta.rating != null && <RatingBadge rating={meta.rating} style={{ flexShrink: 0 }} />}
          </div>
          {hasStats && <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 4, fontSize: 11, color: COLORS.textSecondary }}>
            <GoalAssistIcons g={g} a={a} style={{ color: COLORS.textSecondary }} />
            {y > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 12, borderRadius: 2, background: COLORS.yellow }} />{y > 1 ? y : ""}</span>}
            {rc > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 12, borderRadius: 2, background: COLORS.red }} />{rc > 1 ? rc : ""}</span>}
          </div>}
        </div>
      </div>
      {footName && <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid " + COLORS.border,
        color: COLORS.textMuted, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
        {m ? [
          m.homeLogo ? <TeamLogo key="hl" src={m.homeLogo} name={m.home} size={15} /> : null,
          <span key="hn" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 1 auto", minWidth: 0 }}>{locTeam(m.home, t)}</span>,
          <span key="sc" style={{ fontWeight: 800, color: COLORS.textSecondary, flexShrink: 0 }}>{m.score || "-"}</span>,
          <span key="an" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "0 1 auto", minWidth: 0, textAlign: "right" }}>{locTeam(m.away, t)}</span>,
          m.awayLogo ? <TeamLogo key="al" src={m.awayLogo} name={m.away} size={15} /> : null,
        ] : <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{footName}</span>}
      </div>}
    </div>;
  }

  return <div style={{ display: "flex", gap: 11, padding: "13px 2px", borderBottom: "1px solid " + COLORS.border }}>
    <span style={{ width: 42, height: 42, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0, display: "flex",
      alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 16, fontWeight: 800 }}>{initial}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <UserLink userId={c.user_id} username={name} t={t} style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} />
        <span style={{ color: COLORS.textMuted, fontSize: 12, flexShrink: 0 }}>· {relTime(c.created_at, t && t._lang)}</span>
      </div>
      <div style={{ color: COLORS.textPrimary, fontSize: 14, lineHeight: 1.45, marginBottom: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.body}</div>
      {isPlayer ? playerQuote() : matchQuote()}
    </div>
  </div>;
}

// Community / forum page: every comment, newest first.
function CommunityPage({ onBack, t, onOpenMatch, liveLookup }) {
  var [list, setList] = useState(null);
  useEffect(function(){
    var cancelled = false;
    fetchCommunityFeed(60).then(function(rows){ if (!cancelled) setList(rows); }).catch(function(){ if (!cancelled) setList([]); });
    return function(){ cancelled = true; };
  }, []);
  return <SimplePage title={t.community} onBack={onBack} t={t}>
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {list === null
        ? <SkeletonRows rows={5} />
        : list.length === 0
          ? <EmptyState icon={<EmptyIcon name="chat" />} title="Henüz yorum yok" hint="İlk yorumu sen yaz — bir maça girip topluluğa katıl." />
          : list.map(function(c){ return <CommentCard key={c.id} c={c} onOpenMatch={onOpenMatch} t={t} liveLookup={liveLookup} />; })}
    </div>
  </SimplePage>;
}

// One saved team/player row in the Favorites page.
function FavoriteRow({ rec, onOpen, t }) {
  var sub = rec.meta && (rec.meta.position || rec.meta.country || rec.meta.league);
  var displayName = rec.kind === "team" ? locTeam(rec.name, t) : rec.name;
  return <div onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 6px",
    borderBottom: "1px solid " + COLORS.border, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
    {(rec.kind === "team" || rec.kind === "match")
      ? <TeamLogo src={rec.image} name={rec.name} size={38} />
      : (rec.image
          ? <img src={rec.image} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: COLORS.cardAlt }} />
          : <span style={{ width: 38, height: 38, borderRadius: "50%", background: COLORS.cardAlt, flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontSize: 14, fontWeight: 700 }}>{(rec.name || "?")[0]}</span>)}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName || "?"}</div>
      {sub && <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{sub}</div>}
    </div>
    <FavButton kind={rec.kind} refId={rec.ref_id} name={rec.name} image={rec.image} meta={rec.meta} />
  </div>;
}

// Favorites page: saved teams + players, stacked.
function FavoritesPage({ onBack, t, loggedIn, onLogin, onOpenTeam, onOpenPlayer, onOpenMatch }) {
  useFavorites();
  var recs = Object.keys(FAV.map).map(function(k){ return FAV.map[k]; });
  var teams = recs.filter(function(r){ return r.kind === "team"; });
  var players = recs.filter(function(r){ return r.kind === "player"; });
  var matchFavs = recs.filter(function(r){ return r.kind === "match"; });
  var label = { color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", margin: "18px 2px 6px" };
  return <SimplePage title={t.favorites} onBack={onBack} t={t}>
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      {!loggedIn
        ? <div style={{ textAlign: "center", padding: "44px 0", color: COLORS.textMuted, fontSize: 13 }}>
            {t.favLoginPrompt}
            <div style={{ marginTop: 14 }}><button onClick={onLogin} style={{ padding: "9px 18px", background: COLORS.accent, color: "#fff",
              border: "none", borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>{t.signInBtn}</button></div>
          </div>
        : recs.length === 0
          ? <EmptyState icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>} title="Favori yok" hint="Takım veya oyuncuların yanındaki kaydet butonuna dokun; buraya düşsünler." />
          : <div>
              {matchFavs.length > 0 && <div><div style={label}>{t.matchesLabel || "Maçlar"}</div>
                {matchFavs.map(function(r){ return <FavoriteRow key={r.kind + r.ref_id} rec={r} t={t} onOpen={function(){ if (onOpenMatch) onOpenMatch(r); }} />; })}</div>}
              {teams.length > 0 && <div><div style={label}>{t.teamsLabel}</div>
                {teams.map(function(r){ return <FavoriteRow key={r.kind + r.ref_id} rec={r} t={t} onOpen={function(){ onOpenTeam(r); }} />; })}</div>}
              {players.length > 0 && <div><div style={label}>{t.players}</div>
                {players.map(function(r){ return <FavoriteRow key={r.kind + r.ref_id} rec={r} t={t} onOpen={function(){ onOpenPlayer(r); }} />; })}</div>}
            </div>}
    </div>
  </SimplePage>;
}

// One news card (big hero or compact grid item). Opens the article in a new tab.
function NewsCard({ n, big, lang }) {
  return <a href={n.link} target="_blank" rel="noopener noreferrer"
    style={{ display: "block", textDecoration: "none", background: COLORS.card, borderRadius: 18, overflow: "hidden",
      WebkitTapHighlightColor: "transparent", animation: "moFade 0.26s ease both" }}>
    {n.image && <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: COLORS.cardAlt, overflow: "hidden" }}>
      {/* try the CDN directly first (0 load on us); only browsers the CDN blocks (e.g. Chrome) fall back to our proxy */}
      <img src={n.image} alt="" loading="lazy"
        onError={function(e){
          var img = e.currentTarget;
          if (img.dataset.proxied) { if (img.parentElement) img.parentElement.style.display = "none"; }
          else { img.dataset.proxied = "1"; img.src = "/api/img?u=" + encodeURIComponent(n.image); }
        }}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>}
    <div style={{ padding: big ? "14px 16px 16px" : "10px 12px 13px" }}>
      <div style={{ color: COLORS.textPrimary, fontSize: big ? 17 : 13, fontWeight: big ? 800 : 700, lineHeight: 1.3, marginBottom: 8,
        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.textMuted, fontSize: big ? 12 : 11 }}>
        {n.source && <span style={{ fontWeight: 800, color: COLORS.accent, whiteSpace: "nowrap" }}>{n.source}</span>}
        {n.date && <span style={{ whiteSpace: "nowrap" }}>· {relTime(n.date, lang)}</span>}
      </div>
    </div>
  </a>;
}

// News page (/news): a big hero card on top, a grid of smaller cards below.
function NewsPage({ onBack, t, lang }) {
  var [news, setNews] = useState(null);
  useEffect(function(){
    var cancelled = false;
    fetch("/api/news").then(function(r){ return r.json(); }).then(function(j){ if (!cancelled) setNews(j.news || []); }).catch(function(){ if (!cancelled) setNews([]); });
    return function(){ cancelled = true; };
  }, []);
  return <SimplePage title={t.news} onBack={onBack} t={t}>
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {news === null
        ? <div>
            <Skeleton w={"100%"} h={200} r={18} />
            <div className="mo-newsgrid" style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {[0,1,2,3].map(function(i){ return <div key={i}>
                <Skeleton w={"100%"} h={116} r={16} />
                <Skeleton w={"82%"} h={12} style={{ marginTop: 10 }} />
                <Skeleton w={"48%"} h={10} style={{ marginTop: 8 }} /></div>; })}
            </div>
          </div>
        : news.length === 0
          ? <EmptyState icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h13v16H6a2 2 0 0 1-2-2z"/><path d="M17 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3"/></svg>} title={t.newsSoon} />
          : <div>
              <NewsCard n={news[0]} big lang={lang} />
              <div className="mo-newsgrid" style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {news.slice(1).map(function(n, i){ return <NewsCard key={i} n={n} lang={lang} />; })}
              </div>
            </div>}
    </div>
  </SimplePage>;
}

// Global CSS — rendered on EVERY screen (main + community/settings/etc.) so .mo-matchsheet,
// .mo-scroll, .mo-sticky and the responsive rules apply even on the early-return pages.
// ── Loading & empty primitives (modern product-register vocabulary) ──────────
// Shimmer placeholder block.
function Skeleton({ w, h, r, style }) {
  return <span className="mo-skel" style={Object.assign({ display: "block", width: w == null ? "100%" : w, height: h == null ? 12 : h, borderRadius: r == null ? 8 : r }, style || {})} />;
}
// Match-row-shaped skeletons for feed / list loading (replaces "Yükleniyor…" text).
function SkeletonRows({ rows, avatar, card }) {
  var n = rows || 5; var arr = []; for (var i = 0; i < n; i++) arr.push(i);
  var body = arr.map(function(i){
    return <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 2px", borderBottom: i < n - 1 ? "1px solid " + COLORS.border : "none" }}>
      <Skeleton w={30} h={26} r={7} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{avatar !== false && <Skeleton w={20} h={20} r={10} />}<Skeleton w={"52%"} h={10} /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{avatar !== false && <Skeleton w={20} h={20} r={10} />}<Skeleton w={"40%"} h={10} /></div>
      </div>
      <Skeleton w={34} h={22} r={7} />
    </div>;
  });
  return card === false ? <div>{body}</div> : <div style={{ background: COLORS.card, borderRadius: 18, padding: "4px 12px 8px" }}>{body}</div>;
}
// Teaching empty state: icon + message (+ optional action), never a bare "nothing here".
function EmptyState({ icon, title, hint, action, onAction }) {
  return <div style={{ textAlign: "center", padding: "42px 24px", animation: "moFade 0.26s ease both" }}>
    {icon && <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 14px", background: COLORS.accentDim, color: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>}
    <div style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 800, marginBottom: hint ? 5 : 0 }}>{title}</div>
    {hint && <div style={{ color: COLORS.textMuted, fontSize: 12.5, lineHeight: 1.5, maxWidth: 300, margin: "0 auto" }}>{hint}</div>}
    {action && onAction && <button onClick={onAction} style={{ marginTop: 16, padding: "9px 18px", background: COLORS.accent, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>{action}</button>}
  </div>;
}
// Small inline icons for empty states.
function EmptyIcon({ name }) {
  var p = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "ball") return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m12 7 2.9 2.1-1.1 3.4h-3.6L9.1 9.1z" /></svg>;
  if (name === "chat") return <svg {...p}><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1 3.6-11.3 8.4 8.4 0 0 1 12.5 7.5z" /></svg>;
  if (name === "bell") return <svg {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
  if (name === "coupon") return <svg {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
  if (name === "trophy") return <svg {...p}><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 1-3 3" /></svg>;
  return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>;
}

function AppStyles() {
  return <style>{"@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}" +
    "@keyframes rippleFill{0%{transform:scale(0);opacity:0.18}60%{opacity:0.12}100%{transform:scale(1);opacity:0}}" +
    "@keyframes moDrop{from{opacity:0;transform:translateY(-9px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes moFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes moShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}" +
    ".mo-skel{background:linear-gradient(90deg,var(--cardAlt) 25%,var(--border) 50%,var(--cardAlt) 75%);background-size:200% 100%;animation:moShimmer 1.4s ease-in-out infinite}" +
    // reduced motion: kill decorative animation + long transitions (DESIGN.md requirement)
    "@media(prefers-reduced-motion:reduce){*{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}}" +
    "*{box-sizing:border-box}::-webkit-scrollbar{display:none}html,body{margin:0;-webkit-text-size-adjust:100%}" +
    // keyboard focus ring (mouse/touch users never see it; keyboard users always do)
    "button:focus-visible,a:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}" +
    "input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}" +
    ".mo-shell{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}" +
    ".mo-scroll{-webkit-overflow-scrolling:touch}" +
    ".mo-lgchip{transition:background .2s ease,border-color .2s ease,color .2s ease}" +
    "@media(hover:hover){.mo-lgchip:hover{border-color:var(--accent);color:var(--textPrimary)}}" +
    ".mo-xbtn{transition:background .2s ease,color .2s ease,border-color .2s ease}" +
    "@media(hover:hover){.mo-xbtn:hover{background:var(--accentDim);color:var(--accent);border-color:var(--accent)}}" +
    ".mo-xbtn:active{transform:scale(0.92)}" +
    ".mo-sticky{position:-webkit-sticky;position:sticky;top:0;-webkit-transform:translateZ(0);transform:translateZ(0)}" +
    ".mo-container{max-width:560px;margin:0 auto;width:100%}" +
    ".mo-wide{max-width:1100px;margin:0 auto;width:100%}" +
    ".mo-only-mobile{display:block}.mo-only-desktop{display:none}" +
    ".mo-bottomnav{display:flex}@media(min-width:900px){.mo-bottomnav{display:none}}" +
    ".mo-matchsheet{height:90vh}@media(min-width:900px){.mo-matchsheet{height:97vh}}" +
    ".mo-sporttabs{justify-content:flex-start}@media(min-width:900px){.mo-sporttabs{justify-content:center}}" +
    ".mo-newsgrid{grid-template-columns:repeat(2,1fr)}@media(min-width:700px){.mo-newsgrid{grid-template-columns:repeat(3,1fr)}}" +
    ".mo-logoimg{height:30px}@media(min-width:900px){.mo-logoimg{height:38px}}" +
    ".mo-logoicon{height:34px}@media(min-width:900px){.mo-logoicon{height:44px}}" +
    // light-mode purple navbar: white text/icons/lines, translucent button/input fills, white sport icons
    ".mo-navlight *{color:#fff!important}" +
    ".mo-navlight button{background:rgba(255,255,255,0.16)!important}" +
    ".mo-navlight .mo-sporttabs button{background:transparent!important}" +
    ".mo-navlight svg{stroke:#fff!important}" +
    ".mo-navlight input{background:rgba(255,255,255,0.14)!important;border-color:rgba(255,255,255,0.34)!important}" +
    ".mo-navlight input::placeholder{color:rgba(255,255,255,0.72)!important}" +
    ".mo-navlight img{filter:brightness(0) invert(1)!important}" +
    "@media(min-width:900px){.mo-only-mobile{display:none}.mo-only-desktop{display:block}}" +
    "@media(max-width:899px){body{padding-bottom:calc(58px + env(safe-area-inset-bottom))}}" +
    "@media(max-width:899px){.mo-usingleague .mo-col-left{display:none}}" +
    ".mo-cols{display:flex;flex-direction:column;gap:18px}" +
    ".mo-col-left{width:100%;min-width:0}" +
    ".mo-col-right{width:100%;min-width:0}" +
    "@media(min-width:900px){.mo-cols{flex-direction:row;align-items:flex-start}" +
      ".mo-col-left{width:50%;min-width:0}" +
      ".mo-col-right{width:50%;flex-shrink:0;min-width:0;margin-top:46px}}" +
    ".mo-team-name{font-size:15px}" +
    "@media(min-width:600px){.mo-team-name{font-size:19px}}" +
    ".mo-grid{display:block}" +
    ".mo-header-inner{max-width:560px;margin:0 auto;width:100%}" +
    "@media(min-width:900px){" +
      ".mo-container{max-width:1100px;padding-left:24px;padding-right:24px}" +
      ".mo-header-inner{max-width:none;padding-left:24px;padding-right:24px}" +
      ".mo-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;align-items:start}" +
    "}" +
    "@media(min-width:1300px){" +
      ".mo-container{max-width:1280px}" +
      ".mo-grid{grid-template-columns:repeat(3,1fr)}" +
    "}"}</style>;
}

export default function Home({ initialSport, initialLeagueSlug, initialView }) {
  // update the URL in place without a Next.js navigation (no server round-trip, no remount)
  function pushUrl(url) {
    try { if (typeof window !== "undefined") window.history.pushState(null, "", url); } catch (e) {}
  }
  var [lang, setLang] = useState("tr");
  var [session, setSession] = useState(null);
  var [authReady, setAuthReady] = useState(false);
  var [activeSport, setActiveSport] = useState((initialSport === "live" ? "football" : initialSport) || "football");
  var [slideDir, setSlideDir] = useState(0); // -1 left, 1 right
  var [listKey, setListKey] = useState(0);
  var tabsRef = useRef(null);
  var tabStripRef = useRef(null);
  var [tabInd, setTabInd] = useState({ left: 0, width: 0 }); // sliding underline position
  var [selectedMatch, setSelectedMatch] = useState(null);
  var [query, setQuery] = useState("");
  var [searchFocus, setSearchFocus] = useState(false);
  var [playerResults, setPlayerResults] = useState([]);
  var [matchResults, setMatchResults] = useState([]);
  var [teamResults, setTeamResults] = useState([]);
  var [searching, setSearching] = useState(false);
  var [selectedPlayer, setSelectedPlayer] = useState(null);
  var [selectedTeam, setSelectedTeam] = useState(null);
  var [leagueTree, setLeagueTree] = useState({});       // sport -> grouped country list
  var [leagueTreeLoading, setLeagueTreeLoading] = useState(false);
  var [selectedLeague, setSelectedLeague] = useState(null); // { sport, id, name, season }
  var [leagueMatches, setLeagueMatches] = useState([]);
  var [leagueMatchesLoading, setLeagueMatchesLoading] = useState(false);
  var [standouts, setStandouts] = useState([]);
  var [showStandouts, setShowStandouts] = useState(false);
  var [showProfile, setShowProfile] = useState(false);
  var [showNews, setShowNews] = useState(false);
  var [showSettings, setShowSettings] = useState(false);
  var [showLogin, setShowLogin] = useState(false); // login screen, opened from the header (app is browseable without login)
  var [showMenu, setShowMenu] = useState(false);    // hamburger drawer
  var [mobileSearch, setMobileSearch] = useState(false); // mobile: bottom-nav search input visible
  var [comingSoon, setComingSoon] = useState(null);      // placeholder page (unused now)
  var [showCommunity, setShowCommunity] = useState(false); // community / forum feed
  var [showFavorites, setShowFavorites] = useState(false); // favorites (teams & players)
  var [showPredictions, setShowPredictions] = useState(false); // predictions hub (coupons + leaderboards)
  var [theme, setTheme] = useState("dark"); // default dark; overridden by saved pref on mount
  // Keep the CURRENT_THEME global in sync DURING render (not just in the effect below), so theme-aware
  // helpers like leagueLogo() read the right value in the same render — otherwise logos lag one toggle
  // behind on surfaces that don't re-render often (e.g. the static desktop feed).
  CURRENT_THEME = theme;

  // load saved theme (or system preference) once, then apply on change
  useEffect(function(){
    var saved = null;
    try { saved = localStorage.getItem("theme"); } catch (e) {}
    if (!saved) saved = "dark"; // default to dark mode when the user hasn't chosen
    setTheme(saved);
  }, []);
  useEffect(function(){
    applyTheme(theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
  }, [theme]);
  var [data, setData] = useState({});
  var [loading, setLoading] = useState(false);
  var t = I18N[lang];
  var loggedIn = !!session;
  // once logged in, drop the login overlay (so logging out later doesn't force it back open)
  useEffect(function(){ if (loggedIn) setShowLogin(false); }, [loggedIn]);
  // keep the favorites store in sync with auth (and load this user's saved teams/players)
  useEffect(function(){
    FAV.loggedIn = loggedIn;
    FAV.onNeedLogin = function(){ setShowLogin(true); };
    if (loggedIn) favLoad(); else { FAV.map = {}; FAV.loaded = false; favEmit(); }
  }, [loggedIn]);

  // Track Supabase auth session
  useEffect(function(){
    supabase.auth.getSession().then(function(res){
      setSession(res.data ? res.data.session : null);
      setAuthReady(true);
    });
    var sub = supabase.auth.onAuthStateChange(function(_event, sess){
      setSession(sess);
    });
    return function(){ if (sub && sub.data && sub.data.subscription) sub.data.subscription.unsubscribe(); };
  }, []);

  function logout() {
    supabase.auth.signOut();
    setShowProfile(false);
  }

  // logo click -> back to the main feed (clear search/league/overlays, scroll up)
  function goHome() {
    setShowProfile(false); setShowSettings(false); setShowNews(false);
    setQuery(""); setSelectedLeague(null);
    setSelectedMatch(null); setSelectedPlayer(null); setSelectedTeam(null);
    setMobileSearch(false); setComingSoon(null); setShowCommunity(false); setShowFavorites(false); setShowPredictions(false);
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) {}
  }
  // mobile bottom-nav actions
  function onMobileNav(id) {
    if (id === "mac") { goHome(); }
    else if (id === "arama") { setComingSoon(null); setShowProfile(false); setShowCommunity(false); setShowFavorites(false); setShowPredictions(false); setMobileSearch(true); }
    else if (id === "topluluk") { setMobileSearch(false); setShowProfile(false); setComingSoon(null); setShowFavorites(false); setShowPredictions(false); setShowCommunity(true); }
    else if (id === "tahminler") { setMobileSearch(false); setShowProfile(false); setShowCommunity(false); setComingSoon(null); setShowFavorites(false); setShowPredictions(true); }
    else if (id === "profil") { setMobileSearch(false); setComingSoon(null); setShowCommunity(false); setShowFavorites(false); setShowPredictions(false); if (loggedIn) setShowProfile(true); else setShowLogin(true); }
  }

  function changeSport(id, el) {
    // tapping a sport always leaves the mobile search screen and shows that sport's feed
    setMobileSearch(false); setQuery("");
    if (id === activeSport) {
      if (el && el.scrollIntoView) { try { el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch (e) {} }
      return;
    }
    var fromIdx = SPORT_TABS.findIndex(function(s){ return s.id === activeSport; });
    var toIdx = SPORT_TABS.findIndex(function(s){ return s.id === id; });
    setSlideDir(toIdx > fromIdx ? 1 : -1);
    setListKey(function(k){ return k + 1; });
    setActiveSport(id);
    setSelectedLeague(null);
    pushUrl("/" + id); // in-place URL update, no remount
    // scroll the tapped tab into the visible center of the tab strip
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch (e) {}
    }
  }

  // pick / clear a league + reflect it in the URL (/[sport]/[league]) — in place, no navigation
  function selectLeague(l) {
    var sk = (activeSport === "live") ? "football" : activeSport;
    // leagues belong to football: picking one from the live tab moves the header underline to Futbol
    if (activeSport === "live") setActiveSport("football");
    setSelectedLeague({ sport: sk, id: l.id, name: l.name, season: l.season, logo: l.logo });
    pushUrl("/" + sk + "/" + slugify(l.name));
  }
  function clearLeague() {
    setSelectedLeague(null);
    pushUrl("/" + activeSport);
  }

  // deep-link: /news opens the news page on load
  useEffect(function(){ if (initialView === "news") setShowNews(true); }, []);

  // browser back/forward: re-derive sport + league from the URL (still no remount)
  useEffect(function(){
    function onPop() {
      var parts = (typeof window !== "undefined" ? window.location.pathname : "/").split("/").filter(Boolean);
      if (parts[0] === "news") { setShowNews(true); return; }
      setShowNews(false);
      var sp = parts[0] || "football";
      if (SPORT_TABS.findIndex(function(s){ return s.id === sp; }) === -1) sp = "football";
      setActiveSport(sp);
      var lslug = parts[1] || null;
      if (!lslug) { setSelectedLeague(null); return; }
      var sport = (sp === "live") ? "football" : sp;
      var groups = leagueTree[sport]; var found = null;
      if (groups) groups.forEach(function(g){ (g.leagues || []).forEach(function(l){ if (slugify(l.name) === lslug) found = l; }); });
      setSelectedLeague(found ? { sport: sport, id: found.id, name: found.name, season: found.season, logo: found.logo } : null);
    }
    window.addEventListener("popstate", onPop);
    return function(){ window.removeEventListener("popstate", onPop); };
  }, [leagueTree]);

  useEffect(function(){
    // "live" reads from the football dataset (single source of truth)
    var source = (activeSport === "live") ? "football" : activeSport;
    // re-fetch if we have no real data yet (empty [] is truthy, so it would otherwise stick forever)
    if (data[source] && data[source].length > 0) return;
    var cancelled = false;
    setLoading(true);
    if (source === "football") {
      fetch("/api/football?mode=list").then(function(r){ return r.json(); })
        .then(function(j){ if (cancelled) return;
          var arr = (j.matches && j.matches.length) ? j.matches : [];
          setData(function(p){ return Object.assign({}, p, { football: arr }); });
          setLoading(false); })
        .catch(function(){ if (cancelled) return;
          setData(function(p){ return Object.assign({}, p, { football: [] }); });
          setLoading(false); });
    } else if (source === "basketball" || source === "volleyball" || source === "mma") {
      var sp = source;
      fetch("/api/football?mode=othersport&sport=" + sp).then(function(r){ return r.json(); })
        .then(function(j){ if (cancelled) return;
          var arr = (j.matches && j.matches.length) ? j.matches : [];
          setData(function(p){ var n = {}; n[sp] = arr; return Object.assign({}, p, n); });
          setLoading(false); })
        .catch(function(){ if (cancelled) return;
          setData(function(p){ var n = {}; n[sp] = []; return Object.assign({}, p, n); });
          setLoading(false); });
    } else {
      setTimeout(function(){ if (cancelled) return;
        setData(function(p){ var n = {}; n[activeSport] = MOCK[activeSport] || []; return Object.assign({}, p, n); });
        setLoading(false); }, 300);
    }
    return function(){ cancelled = true; };
  }, [loggedIn, activeSport]);

  // debounced player search (API). Matches are filtered locally below.
  useEffect(function(){
    var q = query.trim();
    if (q.length < 3) { setPlayerResults([]); setMatchResults([]); setTeamResults([]); setSearching(false); return; }
    setSearching(true);
    var id = setTimeout(function(){
      fetch("/api/football?mode=search&q=" + encodeURIComponent(q))
        .then(function(r){ return r.json(); })
        .then(function(j){ setPlayerResults(j.players || []); setMatchResults(j.matches || []); setTeamResults(j.teams || []); setSearching(false); })
        .catch(function(){ setPlayerResults([]); setMatchResults([]); setTeamResults([]); setSearching(false); });
    }, 350);
    return function(){ clearTimeout(id); };
  }, [query]);

  // load the league tree for the active sport (cached per sport); reset any league selection
  useEffect(function(){
    var sport = (activeSport === "live") ? "football" : activeSport;
    setSelectedLeague(null);
    if (leagueTree[sport]) return;
    setLeagueTreeLoading(true);
    // small defer so it doesn't burst alongside the critical match-list fetch (server response is edge-cached)
    var id = setTimeout(function(){
      fetch("/api/football?mode=leagues&sport=" + sport)
        .then(function(r){ return r.json(); })
        .then(function(j){ setLeagueTree(function(p){ var n = {}; n[sport] = j.leagues || []; return Object.assign({}, p, n); }); setLeagueTreeLoading(false); })
        .catch(function(){ setLeagueTree(function(p){ var n = {}; n[sport] = []; return Object.assign({}, p, n); }); setLeagueTreeLoading(false); });
    }, 300);
    return function(){ clearTimeout(id); };
  }, [loggedIn, activeSport]);

  // load fixtures for the clicked league
  useEffect(function(){
    if (!selectedLeague) { setLeagueMatches([]); return; }
    var cancelled = false;
    setLeagueMatchesLoading(true);
    fetch("/api/football?mode=leaguefixtures&sport=" + selectedLeague.sport + "&league=" + selectedLeague.id + "&season=" + (selectedLeague.season || 2025))
      .then(function(r){ return r.json(); })
      .then(function(j){ if (cancelled) return; setLeagueMatches(j.matches || []); setLeagueMatchesLoading(false); })
      .catch(function(){ if (cancelled) return; setLeagueMatches([]); setLeagueMatchesLoading(false); });
    return function(){ cancelled = true; };
  }, [selectedLeague]);

  // open the league from the initial URL slug ONCE, after the tree loads (deep link / refresh)
  var didDeepLinkRef = useRef(false);
  useEffect(function(){
    if (didDeepLinkRef.current || !initialLeagueSlug) return;
    var sport = (activeSport === "live") ? "football" : activeSport;
    var groups = leagueTree[sport];
    if (!groups || !groups.length) return; // wait until the tree is loaded
    var found = null;
    groups.forEach(function(g){ (g.leagues || []).forEach(function(l){ if (slugify(l.name) === initialLeagueSlug) found = l; }); });
    if (found) setSelectedLeague({ sport: sport, id: found.id, name: found.name, season: found.season, logo: found.logo });
    didDeepLinkRef.current = true; // tree is loaded now; don't run again
  }, [initialLeagueSlug, leagueTree, activeSport]);

  // position the sliding underline under the active sport tab
  useEffect(function(){
    function measure(){
      var strip = tabStripRef.current; if (!strip) return;
      var idx = SPORT_TABS.findIndex(function(s){ return s.id === activeSport; });
      var el = strip.children[idx];
      if (el) setTabInd({ left: el.offsetLeft, width: el.offsetWidth });
    }
    measure();
    var id = setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    return function(){ clearTimeout(id); window.removeEventListener("resize", measure); };
  }, [activeSport, loggedIn]);

  // standouts of the day (football only), fetched once — DEFERRED so its heavy burst of
  // api-sports calls doesn't compete with the critical match-list fetch and trip rate limits.
  useEffect(function(){
    if (activeSport !== "football" && activeSport !== "live") return;
    if (standouts.length > 0) return;
    var id = setTimeout(function(){
      fetch("/api/football?mode=standouts&sport=football")
        .then(function(r){ return r.json(); })
        .then(function(j){ setStandouts(j.players || []); })
        .catch(function(){ setStandouts([]); });
    }, 3000);
    return function(){ clearTimeout(id); };
  }, [loggedIn, activeSport]);


  // auto-refresh football data every 45s so live scores/minutes/status stay fresh
  useEffect(function(){
    if (activeSport !== "football" && activeSport !== "live") return;
    var id = setInterval(function(){
      fetch("/api/football?mode=list").then(function(r){ return r.json(); })
        .then(function(j){ if (j.matches && j.matches.length) setData(function(p){ return Object.assign({}, p, { football: j.matches }); }); })
        .catch(function(){});
    }, 45000);
    return function(){ clearInterval(id); };
  }, [loggedIn, activeSport]);

  if (!authReady) return <Splash fade={false} />;
  if (showLogin && !loggedIn) return <LoginScreen onClose={function(){ setShowLogin(false); }} t={t} lang={lang} setLang={setLang} theme={theme} />;
  if (showProfile) return <><AppStyles /><ProfilePage onBack={function(){ setShowProfile(false); }} onLogout={logout} session={session} t={t} lang={lang} setLang={setLang}
      onOpenTeam={function(r){ setSelectedTeam({ id: r.ref_id, name: r.name, logo: r.image }); }}
      onOpenPlayer={function(r){ setSelectedPlayer({ id: r.ref_id, name: r.name, photo: r.image }); }} />
    <MobileBottomNav active="profil" onSelect={onMobileNav} t={t} />
    {selectedTeam && <TeamModal team={selectedTeam} t={t} onClose={function(){ setSelectedTeam(null); }} onOpenMatch={function(m){ setSelectedMatch(m); }} />}
    {selectedPlayer && <PlayerModal player={selectedPlayer} t={t} onClose={function(){ setSelectedPlayer(null); }} />}
    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t} onClose={function(){ setSelectedMatch(null); }} />}</>;
  if (showSettings) return <SimplePage title={t.settings} onBack={function(){ setShowSettings(false); }} t={t}>
    <div style={{ marginBottom: 22 }}>
      <div style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 10 }}>{t.appearance}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.card,
        border: "none", borderRadius: 14, padding: "14px 16px" }}>
        <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>{t.darkMode}</span>
        <button onClick={function(){ setTheme(theme === "dark" ? "light" : "dark"); }} aria-label="toggle dark mode"
          style={{ width: 50, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
            background: theme === "dark" ? COLORS.accent : COLORS.border, transition: "background 0.3s ease",
            WebkitTapHighlightColor: "transparent" }}>
          <span style={{ position: "absolute", top: 3, left: theme === "dark" ? 25 : 3, width: 22, height: 22, borderRadius: "50%",
            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left 0.3s cubic-bezier(0.22,1,0.36,1)" }} />
        </button>
      </div>
    </div>
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", marginBottom: 10 }}>{t.language}</div>
      <LangSwitch lang={lang} setLang={setLang} />
    </div>
    <div style={{ color: COLORS.textMuted, fontSize: 13 }}>{t.moreSoon}</div>
  </SimplePage>;
  if (showNews) return <><AppStyles /><NewsPage onBack={function(){ setShowNews(false); pushUrl("/" + activeSport); }} t={t} lang={lang} /></>;
  if (comingSoon) return <><AppStyles /><SimplePage title={comingSoon} onBack={function(){ setComingSoon(null); }} t={t}>
    <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: "40px 0" }}>Yakında.</div>
  </SimplePage>
    <MobileBottomNav active="favoriler" onSelect={onMobileNav} t={t} /></>;
  // a community snapshot freezes the score/status at comment time; prefer the live version from the current feed
  function freshMatch(id) {
    if (id == null) return null;
    var sid = String(id);
    var keys = Object.keys(data || {});
    for (var i = 0; i < keys.length; i++) {
      var arr = data[keys[i]] || [];
      for (var j = 0; j < arr.length; j++) { if (String(arr[j].id) === sid) return arr[j]; }
    }
    return null;
  }
  if (showCommunity) return <><AppStyles /><CommunityPage onBack={function(){ setShowCommunity(false); }} t={t} liveLookup={freshMatch}
      onOpenMatch={function(m){ setSelectedMatch(freshMatch(m.id) || m); }} />
    <MobileBottomNav active="topluluk" onSelect={onMobileNav} t={t} />
    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t} onClose={function(){ setSelectedMatch(null); }} />}</>;
  if (showFavorites) return <><AppStyles />
    <FavoritesPage onBack={function(){ setShowFavorites(false); }} t={t} loggedIn={loggedIn}
      onLogin={function(){ setShowLogin(true); }}
      onOpenTeam={function(r){ setSelectedTeam({ id: r.ref_id, name: r.name, logo: r.image }); }}
      onOpenPlayer={function(r){ setSelectedPlayer({ id: r.ref_id, name: r.name, photo: r.image }); }}
      onOpenMatch={function(r){ setSelectedMatch(freshMatch(r.ref_id) || r.meta || { id: r.ref_id }); }} />
    <MobileBottomNav active="favoriler" onSelect={onMobileNav} t={t} />
    {selectedTeam && <TeamModal team={selectedTeam} t={t} onClose={function(){ setSelectedTeam(null); }} onOpenMatch={function(m){ setSelectedMatch(m); }} />}
    {selectedPlayer && <PlayerModal player={selectedPlayer} t={t} onClose={function(){ setSelectedPlayer(null); }} />}
    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t} onClose={function(){ setSelectedMatch(null); }} />}</>;

  if (showPredictions) return <><AppStyles />
    <PredictionsPage onBack={function(){ setShowPredictions(false); }} t={t} loggedIn={loggedIn}
      onLogin={function(){ setShowLogin(true); }}
      onOpenMatch={function(m){ setSelectedMatch(freshMatch(m && m.id) || m); }} />
    <MobileBottomNav active="tahminler" onSelect={onMobileNav} t={t} />
    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t} onClose={function(){ setSelectedMatch(null); }} />}</>;

  var matches = data[activeSport] || [];
  // light mode: paint the top navbar in the brand purple with white content (.mo-navlight)
  var headerPurple = theme === "light";
  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: FONT, display: "flex", flexDirection: "column" }}>
    <AppStyles />
    <Splash fade={true} />

    <div className="mo-shell" style={{ flex: "1 0 auto" }}>
      <div className="mo-sticky" style={{ zIndex: 10, background: headerPurple ? COLORS.accentGrad : COLORS.card,
        boxShadow: headerPurple ? "0 3px 14px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.22)" : ("0 1px 0 " + COLORS.border + ", 0 3px 14px rgba(0,0,0,0.12)"),
        paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className={"mo-header-inner" + (headerPurple ? " mo-navlight" : "")} style={{ padding: "0 16px 8px" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}><Logo theme={theme} onHome={goHome} /></div>
            {/* search — absolutely centered on the page (desktop only); logo grows to push the buttons to the right edge */}
            <div className="mo-only-desktop" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 340, maxWidth: "calc(100% - 520px)", zIndex: 1 }}>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={searchFocus ? COLORS.accent : COLORS.textMuted}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.3s ease" }}>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              </span>
              <input value={query} onChange={function(e){ setQuery(e.target.value); }}
                onFocus={function(){ setSearchFocus(true); }} onBlur={function(){ setSearchFocus(false); }}
                placeholder={t.searchPlaceholder}
                style={{ width: "100%", padding: "9px 12px 9px 38px", borderRadius: 12, fontSize: 14, outline: "none",
                  fontFamily: FONT, color: COLORS.textPrimary, boxSizing: "border-box", background: COLORS.cardAlt,
                  border: "1px solid " + (searchFocus ? COLORS.accent + "66" : COLORS.border),
                  transition: "border-color 0.3s ease" }} />
              {query && <button onClick={function(){ setQuery(""); }} aria-label="clear" style={{ position: "absolute", right: 8,
                top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: 7, border: "none",
                background: COLORS.card, color: COLORS.textSecondary, cursor: "pointer", fontSize: 13, lineHeight: 1,
                WebkitTapHighlightColor: "transparent" }}>×</button>}
            </div>
            </div>
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {/* community (desktop only — mobile uses the bottom-nav "Topluluk") */}
              <span className="mo-only-desktop">
                <button onClick={function(){ setShowCommunity(true); }} aria-label={t.community} style={{ display: "flex", alignItems: "center", gap: 7,
                  height: 38, padding: "0 13px", borderRadius: 12, background: COLORS.cardAlt, border: "none", cursor: "pointer", color: COLORS.textPrimary,
                  fontSize: 13, fontWeight: 700, fontFamily: FONT, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
                  <MaskIcon src={NAV_IMG.topluluk} size={18} />
                  {t.community}
                </button>
              </span>
              {/* predictions (desktop only — mobile uses the bottom-nav "Tahminler") */}
              <span className="mo-only-desktop">
                <button onClick={function(){ setShowPredictions(true); }} aria-label={t.navPredictions} style={{ display: "flex", alignItems: "center", gap: 7,
                  height: 38, padding: "0 13px", borderRadius: 12, background: COLORS.cardAlt, border: "none", cursor: "pointer", color: COLORS.textPrimary,
                  fontSize: 13, fontWeight: 700, fontFamily: FONT, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                  {t.navPredictions}
                </button>
              </span>
              {/* news (label shown on desktop only) */}
              <button onClick={function(){ setShowNews(true); pushUrl("/news"); }} aria-label={t.news} style={{ height: 38, padding: "0 11px", borderRadius: 12,
                background: COLORS.cardAlt, border: "none", cursor: "pointer", display: "flex", gap: 7,
                color: COLORS.textPrimary, fontSize: 13, fontWeight: 700, fontFamily: FONT, whiteSpace: "nowrap",
                alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={COLORS.textPrimary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9h-3" /><path d="M7 8h6M7 12h6M7 16h4" /></svg>
                <span className="mo-only-desktop">{t.news}</span>
              </button>
              {/* profile (signed in) / sign-in — desktop only, to the right of news; mobile uses the bottom nav */}
              <span className="mo-only-desktop">
                {loggedIn
                  ? <button onClick={function(){ setShowProfile(true); }} aria-label="profile" style={{ width: 38, height: 38, borderRadius: 12,
                      background: COLORS.cardAlt, border: "none", cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={COLORS.textPrimary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>
                    </button>
                  : <button onClick={function(){ setShowLogin(true); }} style={{ display: "flex", alignItems: "center", gap: 7, height: 38, padding: "0 14px", borderRadius: 12,
                      background: COLORS.accent, border: "none", cursor: "pointer", color: "#fff", fontSize: 13, fontWeight: 700,
                      fontFamily: FONT, whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" /></svg>
                      {t.signInBtn}
                    </button>}
              </span>
              {/* notifications bell (scored coupons) */}
              <NotificationsBell loggedIn={loggedIn} matches={data.football || []} t={t} onOpenMatch={function(m){ setSelectedMatch(freshMatch(m && m.id) || m); }} />
              {/* hamburger — far right (settings, language, theme) */}
              <button onClick={function(){ setShowMenu(true); }} aria-label={t.menu} style={{ width: 38, height: 38, borderRadius: 12,
                background: COLORS.cardAlt, border: "none", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent" }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={COLORS.textPrimary} strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              </button>
            </div>
            </div>
          {/* mobile search row — toggled by the bottom-nav "Ara" item */}
          {mobileSearch && <div className="mo-only-mobile" style={{ position: "relative", marginBottom: 8 }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={COLORS.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            </span>
            <input autoFocus value={query} onChange={function(e){ setQuery(e.target.value); }} placeholder={t.searchPlaceholder}
              style={{ width: "100%", padding: "10px 38px", borderRadius: 12, fontSize: 14, outline: "none", fontFamily: FONT,
                color: COLORS.textPrimary, boxSizing: "border-box", background: COLORS.cardAlt, border: "1px solid " + COLORS.border }} />
            <button onClick={function(){ setQuery(""); setMobileSearch(false); }} aria-label="kapat" style={{ position: "absolute", right: 8,
              top: "50%", transform: "translateY(-50%)", width: 24, height: 24, borderRadius: 8, border: "none", background: COLORS.card,
              color: COLORS.textSecondary, cursor: "pointer", fontSize: 14, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>×</button>
          </div>}
          <div ref={tabStripRef} className="mo-sporttabs mo-scroll" style={{ position: "relative", display: "flex", gap: 2, overflowX: "auto", paddingBottom: 8 }}>
            {SPORT_TABS.map(function(sp){ var a = activeSport === sp.id;
              return <SportTab key={sp.id} active={a} icon={sp.icon} label={t.sports[sp.id]} live={sp.id === "live"}
                onClick={function(e){ changeSport(sp.id, e.currentTarget); }} />; })}
            {/* clean sliding underline under the active tab */}
            <span aria-hidden style={{ position: "absolute", bottom: 2, height: 3, borderRadius: 3, background: headerPurple ? "#fff" : COLORS.accent,
              left: tabInd.left + tabInd.width * 0.22, width: tabInd.width * 0.56, opacity: tabInd.width ? 1 : 0, pointerEvents: "none",
              transition: "left 0.38s cubic-bezier(0.22,1,0.36,1), width 0.38s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease" }} />
          </div>
        </div>
      </div>

      <div className="mo-wide" style={{ padding: "16px 16px max(80px, env(safe-area-inset-bottom))", overflow: "hidden" }}>
        <SlidePanel slideKey={listKey} dir={slideDir}>
            {loading ? <div style={{ padding: "2px 0" }}><SkeletonRows rows={7} /></div>
             : (function(){
              var q = query.trim().toLowerCase();
              var isF1 = activeSport === "motorsport";
              // query active -> dedicated search view: matches (local + API team fixtures) + players (API)
              if (q) {
                var localMatches = matches.filter(function(m){
                  return (m.home && m.home.toLowerCase().indexOf(q) >= 0) ||
                         (m.away && m.away.toLowerCase().indexOf(q) >= 0) ||
                         (m.league && m.league.toLowerCase().indexOf(q) >= 0);
                });
                // merge local + API matches, dedupe by id, keep live > upcoming > finished
                var mseen = {}; var mergedMatches = [];
                localMatches.concat(matchResults || []).forEach(function(m){
                  if (m && m.id != null && !mseen[m.id]) { mseen[m.id] = 1; mergedMatches.push(m); }
                });
                var mrank = function(s){ return s === "live" ? 0 : (s === "upcoming" ? 1 : 2); };
                mergedMatches.sort(function(a, b){ return mrank(a.status) - mrank(b.status); });
                return <SearchResults teams={teamResults} matches={mergedMatches} players={playerResults} searching={searching}
                  isF1={false} t={t}
                  onOpenMatch={function(m){ setSelectedMatch(m); }}
                  onOpenPlayer={function(p){ setSelectedPlayer(p); }}
                  onOpenTeam={function(tm){ setSelectedTeam(tm); }} />;
              }
              // mobile search screen, no query yet -> SofaScore-style discovery
              if (mobileSearch) return <SearchDiscovery t={t}
                onOpenLeague={function(l){ setMobileSearch(false); selectLeague(l); }}
                onOpenTeam={function(tm){ setSelectedTeam(tm); }}
                onOpenPlayer={function(p){ setSelectedPlayer(p); }} />;
              var shown = matches;
              // carousel: live first, then soon-upcoming
              var featured = shown.filter(function(m){ return m.status === "live" || m.status === "upcoming"; })
                .slice().sort(function(a, b){ var r = function(s){ return s === "live" ? 0 : 1; }; return r(a.status) - r(b.status); })
                .slice(0, 6);
              var lg = featured[0] || shown[0] || {};
              var tree = leagueTree[activeSport] || [];
              // World Cup season for the "team of the round" box (fallback 2026)
              var wcSeason = 2026;
              (data.football || []).forEach(function(m){ if (m.leagueId === 1 && m.season) wcSeason = m.season; });
              var usingLeague = !!selectedLeague;
              return <div>
                {/* league bar under the header (mobile + desktop): World Cup first, tap -> detail in the main column */}
                {!isF1 && <LeagueStrip groups={tree} t={t}
                  selectedId={selectedLeague && selectedLeague.id}
                  onSelect={function(l){ selectLeague(l); }}
                  onClear={clearLeague} />}
                <div className={"mo-cols" + (usingLeague ? " mo-usingleague" : "")}>
                {/* LEFT: the match feed (always). Hidden on mobile while a league detail is open. */}
                <div className="mo-col-left">
                  <DayMatchList matches={shown} t={t} isF1={isF1} onOpen={function(m){ setSelectedMatch(m); }} />
                </div>
                {/* RIGHT: the selected league's detail, else the sidebar boxes (aligned below the feed's tabs) */}
                <div className="mo-col-right">
                  {usingLeague
                    ? <LeagueDetailPanel league={selectedLeague} matches={leagueMatches} matchesLoading={leagueMatchesLoading}
                        t={t} onOpenMatch={function(m){ setSelectedMatch(m); }} onClear={clearLeague} />
                    : <div className="mo-sidebar">
                        <FeaturedCarousel matches={featured} isF1={isF1} t={t} onOpen={function(m){ setSelectedMatch(m); }} />
                        {activeSport === "football" && <HaftaninTakimi season={wcSeason} t={t} onOpenPlayer={function(p){ setSelectedPlayer(p); }} />}
                        <StandoutsBox players={activeSport === "football" ? standouts : []} t={t}
                          onOpen={function(){ if (standouts.length) setShowStandouts(true); }} />
                        {!isF1 && lg.leagueId && <MajorStats leagueId={lg.leagueId} season={lg.season || 2025} t={t} />}
                      </div>}
                </div>
              </div>
              </div>;
            })()}
          </SlidePanel>
      </div></div>

    <footer style={{ flexShrink: 0, textAlign: "center", padding: "26px 16px max(26px, env(safe-area-inset-bottom))",
      background: COLORS.cardAlt, borderTop: "1px solid " + COLORS.border, color: COLORS.textMuted, fontSize: 12, lineHeight: 1.9 }}>
      <div style={{ fontWeight: 800, color: COLORS.textSecondary, letterSpacing: "0.3px", fontSize: 14 }}>fikstür.com</div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", margin: "6px 0" }}>
        {["İletişim", "Gizlilik", "Kullanım Şartları"].map(function(lbl, i){
          return <span key={i} role="link" tabIndex={0} style={{ cursor: "pointer", color: COLORS.textSecondary, WebkitTapHighlightColor: "transparent" }}
            onMouseEnter={function(e){ e.currentTarget.style.color = COLORS.accent; }}
            onMouseLeave={function(e){ e.currentTarget.style.color = COLORS.textSecondary; }}>{lbl}</span>; })}
      </div>
      <div>© 2026 fikstür.com · Tüm hakları saklıdır.</div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>Veriler API-Football tarafından sağlanmaktadır.</div>
    </footer>

    {selectedPlayer && <PlayerModal player={selectedPlayer} t={t}
      onClose={function(){ setSelectedPlayer(null); }} />}
    {selectedTeam && <TeamModal team={selectedTeam} t={t}
      onClose={function(){ setSelectedTeam(null); }}
      onOpenMatch={function(m){ setSelectedMatch(m); }} />}
    {showStandouts && standouts.length > 0 && <StandoutsRating players={standouts} t={t}
      onClose={function(){ setShowStandouts(false); }} />}
    {/* match modal rendered last so it stacks above team/player modals when opened from within them */}
    {selectedMatch && <MatchModal match={selectedMatch} isF1={activeSport === "motorsport"} t={t}
      onClose={function(){ setSelectedMatch(null); }} />}
    {showMenu && <MenuDrawer onClose={function(){ setShowMenu(false); }} theme={theme} setTheme={setTheme} lang={lang} setLang={setLang} t={t}
      onSettings={function(){ setShowSettings(true); }} onNews={function(){ setShowNews(true); }}
      onFavorites={function(){ setShowFavorites(true); }} />}
    <MobileBottomNav active={(mobileSearch || query) ? "arama" : "mac"} onSelect={onMobileNav} t={t} />
  </div>;
}