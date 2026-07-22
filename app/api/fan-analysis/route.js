// app/api/fan-analysis/route.js — AI "taraftar kişiliği" analizi via Google Gemini.
// Sibling of /api/preview: same key, same model, same always-200 response shape.
//
// Called ONLY by the native app's Supabase Edge Function (ai-fan-analysis), which does the
// user auth + premium check first. This route exists so the Gemini key lives in exactly ONE
// place (the Cloudflare Worker secret) instead of being copied into Supabase too.
//
// Two deliberate hardening choices vs. /api/preview (which is fully public):
//  1. It takes STRUCTURED stats only, never a free-form prompt — the prompt is built here, so
//     this can't be abused as a general-purpose Gemini proxy on our quota.
//  2. It requires the FAN_ANALYSIS_SECRET shared header (set via `wrangler secret put`), so
//     only our own backend can call it. Fails closed if the secret isn't configured.

const KEY = process.env.GEMINI_API_KEY || "";
const SECRET = process.env.FAN_ANALYSIS_SECRET || "";
const MODEL = "gemini-2.5-flash-lite";

const SYSTEM =
  "Sen bir futbol taraftar profili analistisin. Sana verilen, kullanıcının kendi maç günlüğünden " +
  "çıkarılmış verilere dayanarak Türkçe, 2-3 cümlelik, samimi ve KİŞİSELLEŞTİRİLMİŞ bir " +
  "'taraftar kişiliği' analizi yaz. SOMUT verilere atıfta bulun (kaç maç loglamış, hangi " +
  "etiketler baskın, ortalama puanı ne). Uydurma istatistik verme, sadece verilenlerden çıkarım yap. " +
  "Klişe kalıplardan kaçın, her analizi farklı bir cümleyle başlat. Madde madde değil, tek akıcı " +
  "paragraf yaz. Sadece analiz metnini döndür; başlık, giriş cümlesi ya da açıklama ekleme.";

function buildContext(b) {
  const L = [];
  L.push("Loglanan maç sayısı: " + (b.logCount != null ? b.logCount : "?"));
  const tc = b.tagCount && typeof b.tagCount === "object" ? b.tagCount : null;
  if (tc) {
    const keys = Object.keys(tc).slice(0, 20);
    if (keys.length) L.push("Etiket dağılımı: " + keys.map(function (k) { return k + "=" + tc[k]; }).join(", "));
  }
  if (Array.isArray(b.topTags) && b.topTags.length) L.push("En baskın etiketler: " + b.topTags.slice(0, 5).join(", "));
  if (b.avgRating != null && b.avgRating !== "") L.push("Ortalama puanı: " + b.avgRating);
  return L.join("\n");
}

export async function POST(request) {
  // fail closed: without a configured secret this route is disabled entirely
  if (!SECRET) return Response.json({ error: "not_configured", text: "" });
  if (request.headers.get("x-fan-secret") !== SECRET) return Response.json({ error: "forbidden", text: "" });

  let b;
  try { b = await request.json(); } catch (e) { return Response.json({ error: "bad_request", text: "" }); }
  if (!KEY) return Response.json({ error: "no_key", text: "" });
  if (!b.logCount) return Response.json({ error: "no_logs", text: "" });

  const prompt = SYSTEM + "\n\nVeriler:\n" + buildContext(b);
  async function callGemini() {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 300, topP: 0.95, topK: 64 },
      }),
    });
    return await r.json();
  }
  let j;
  try {
    j = await callGemini();
    // retry once on transient overload (not on quota/key errors) — same as /api/preview
    if (j && j.error && /high demand|overload|unavailable|try again|temporar|5\d\d/i.test(j.error.message || "")) {
      await new Promise(function (res) { setTimeout(res, 1500); });
      j = await callGemini();
    }
  } catch (e) { return Response.json({ error: "gemini_fetch", text: "" }); }
  if (j && j.error) return Response.json({ error: "gemini", detail: j.error.message || "", text: "" });
  let text = (((((j || {}).candidates || [])[0] || {}).content || {}).parts || [])[0];
  text = ((text && text.text) || "").trim();
  if (!text) return Response.json({ error: "empty", text: "" });

  return Response.json({ text: text });
}
