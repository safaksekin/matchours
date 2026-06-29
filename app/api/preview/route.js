// app/api/preview/route.js — AI pre-match preview via Google Gemini (free tier).
// No Python / no separate service: a plain HTTPS call from the Worker, cached in
// Supabase by match id so the free quota isn't burned (everyone shares one preview).
// Needs GEMINI_API_KEY (server-only) + the existing Supabase service key.

const KEY = process.env.GEMINI_API_KEY || "";
const MODEL = "gemini-2.5-flash-lite";
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SB_ON = !!(SB_URL && SB_KEY);

const SYSTEM =
  "Sen deneyimli bir futbol maç önü analistisin. Sana verilen verilere dayanarak, " +
  "taraftarlar için KISA (en fazla 4-5 cümle), akıcı ve Türkçe bir maç önü analizi yaz. " +
  "Sadece verilen verilerden çıkarım yap, uydurma istatistik verme. Kesin skor tahmini yapma; " +
  "hangi takımın daha avantajlı göründüğünü, form ve puan durumunu, varsa H2H eğilimini vurgula. " +
  "Madde madde değil, tek akıcı paragraf yaz. Veriler eksikse elindekiyle yorum yap.";

function sbHdr() { return { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" }; }
async function cacheGet(key) {
  if (!SB_ON) return null;
  try {
    const r = await fetch(SB_URL + "/rest/v1/api_cache?key=eq." + encodeURIComponent(key) + "&select=payload,expires_at", { headers: sbHdr() });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.payload;
  } catch (e) { return null; }
}
async function cacheSet(key, payload, ttl) {
  if (!SB_ON) return;
  try {
    const expires = new Date(Date.now() + ttl * 1000).toISOString();
    await fetch(SB_URL + "/rest/v1/api_cache?on_conflict=key", {
      method: "POST",
      headers: Object.assign(sbHdr(), { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ key: key, payload: payload, expires_at: expires }),
    });
  } catch (e) {}
}

function buildContext(b) {
  const L = [];
  L.push("Maç: " + (b.home || "?") + " - " + (b.away || "?") + (b.league ? " (" + b.league + ")" : ""));
  if (b.date) L.push("Tarih: " + b.date);
  if (Array.isArray(b.standings) && b.standings.length) {
    L.push("Puan durumu:");
    b.standings.forEach(function (r) {
      L.push("- " + r.team + ": " + (r.rank != null ? r.rank + ". sıra" : "") +
        (r.points != null ? ", " + r.points + " puan" : "") + (r.played != null ? ", " + r.played + " maç" : ""));
    });
  }
  if (Array.isArray(b.homeForm) && b.homeForm.length) L.push((b.home || "Ev") + " son maçlar: " + b.homeForm.join(" "));
  if (Array.isArray(b.awayForm) && b.awayForm.length) L.push((b.away || "Deplasman") + " son maçlar: " + b.awayForm.join(" "));
  if (b.h2h && (b.h2h.homeWins != null || b.h2h.draws != null || b.h2h.awayWins != null)) {
    L.push("Aralarındaki maçlar: " + (b.home || "Ev") + " " + (b.h2h.homeWins || 0) + " galibiyet, " +
      (b.h2h.draws || 0) + " beraberlik, " + (b.away || "Deplasman") + " " + (b.h2h.awayWins || 0) + " galibiyet");
  }
  if (Array.isArray(b.recentH2H) && b.recentH2H.length) L.push("Son karşılaşmalar: " + b.recentH2H.join(", "));
  return L.join("\n");
}

export async function POST(request) {
  if (!KEY) return Response.json({ error: "no_key", text: "" });
  let b;
  try { b = await request.json(); } catch (e) { return Response.json({ error: "bad_request", text: "" }); }
  const matchId = String(b.matchId || "");
  const cacheKey = "preview:" + matchId;

  if (matchId) {
    const hit = await cacheGet(cacheKey);
    if (hit && hit.text) return Response.json({ text: hit.text, cached: true });
  }

  const prompt = SYSTEM + "\n\nVeriler:\n" + buildContext(b);
  let text = "";
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 400, topP: 0.9 },
      }),
    });
    const j = await r.json();
    if (j && j.error) return Response.json({ error: "gemini", detail: j.error.message || "", text: "" });
    text = (((((j || {}).candidates || [])[0] || {}).content || {}).parts || [])[0];
    text = (text && text.text) || "";
    text = text.trim();
  } catch (e) { return Response.json({ error: "gemini_fetch", text: "" }); }
  if (!text) return Response.json({ error: "empty", text: "" });

  // upcoming previews are stable for a while; finished -> keep long
  if (matchId) await cacheSet(cacheKey, { text: text }, b.status === "finished" ? 2592000 : 21600);
  return Response.json({ text: text });
}
