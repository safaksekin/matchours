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
  "SAYISAL verilere dayan: gol ortalamaları, averaj, puan farkı, form ve H2H skorları gibi " +
  "SOMUT rakamları cümle içinde kullan. Sadece verilen verilerden çıkarım yap, uydurma istatistik verme. " +
  "Kesin skor tahmini yapma; hangi takımın daha avantajlı göründüğünü gerekçeleriyle vurgula. " +
  "Her analizi FARKLI ve özgün bir cümleyle başlat; klişe/kalıp girişlerden " +
  "('X ve Y karşı karşıya geliyor', 'dev mücadele', 'kritik maç' gibi) KESİNLİKLE kaçın. " +
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
        (r.points != null ? ", " + r.points + " puan" : "") +
        (r.played != null ? ", O" + r.played : "") +
        (r.win != null ? " (" + r.win + "G " + r.draw + "B " + r.lose + "M)" : "") +
        (r.gd != null ? ", averaj " + (r.gd > 0 ? "+" + r.gd : r.gd) : ""));
    });
  }
  if (b.season && (b.season.home || b.season.away)) {
    const sLine = function (name, sx) {
      if (!sx) return null;
      const p = [];
      if (sx.played) p.push(sx.played + " maç");
      if (sx.wins != null) p.push(sx.wins + "G " + (sx.draws || 0) + "B " + (sx.loses || 0) + "M");
      if (sx.goalsFor != null && sx.played) p.push("maç başı " + (sx.goalsFor / sx.played).toFixed(2) + " gol attı");
      if (sx.goalsAgainst != null && sx.played) p.push("maç başı " + (sx.goalsAgainst / sx.played).toFixed(2) + " gol yedi");
      if (sx.cleanSheets != null) p.push(sx.cleanSheets + " maçta kalesini gole kapadı");
      return p.length ? ("- " + name + ": " + p.join(", ")) : null;
    };
    L.push("Sezon istatistikleri:");
    const sh = sLine(b.home, b.season.home); if (sh) L.push(sh);
    const sa = sLine(b.away, b.season.away); if (sa) L.push(sa);
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
  let b;
  try { b = await request.json(); } catch (e) { return Response.json({ error: "bad_request", text: "" }); }
  const matchId = String(b.matchId || "");
  const cacheKey = "preview:" + matchId;

  if (matchId) {
    const hit = await cacheGet(cacheKey);
    if (hit && hit.text) return Response.json({ text: hit.text, cached: true });
  }
  // peek = only return a cached preview; never generate (used to auto-show on open)
  if (b.peek) return Response.json({ text: "" });
  if (!KEY) return Response.json({ error: "no_key", text: "" });

  const prompt = SYSTEM + "\n\nVeriler:\n" + buildContext(b);
  async function callGemini() {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 450, topP: 0.95, topK: 64 },
      }),
    });
    return await r.json();
  }
  let j;
  try {
    j = await callGemini();
    // retry once on transient overload (not on quota/key errors)
    if (j && j.error && /high demand|overload|unavailable|try again|temporar|5\d\d/i.test(j.error.message || "")) {
      await new Promise(function (res) { setTimeout(res, 1500); });
      j = await callGemini();
    }
  } catch (e) { return Response.json({ error: "gemini_fetch", text: "" }); }
  if (j && j.error) return Response.json({ error: "gemini", detail: j.error.message || "", text: "" });
  let text = (((((j || {}).candidates || [])[0] || {}).content || {}).parts || [])[0];
  text = ((text && text.text) || "").trim();
  if (!text) return Response.json({ error: "empty", text: "" });

  // upcoming previews are stable for a while; finished -> keep long
  if (matchId) await cacheSet(cacheKey, { text: text }, b.status === "finished" ? 2592000 : 21600);
  return Response.json({ text: text });
}
