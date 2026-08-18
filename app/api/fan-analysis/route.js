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
//
// v2 (weekly personality): the answer is now a JSON pair — a short ARCHETYPE title ("Gol
// Avcısı" / "The Goal Hunter") plus a 2-sentence portrait — in the APP'S language, written to
// read like someone who knows this fan, not like a stats readout. Length is capped both in the
// prompt and in maxOutputTokens.

const KEY = process.env.GEMINI_API_KEY || "";
const SECRET = process.env.FAN_ANALYSIS_SECRET || "";
const MODEL = "gemini-2.5-flash-lite";

const LANG_NAME = { tr: "Turkish", en: "English", de: "German", es: "Spanish", it: "Italian" };

// The voice this is written in matters more than the data: the user called the old output
// "reading my stats back to me". The rules below are the fix — the numbers are the EVIDENCE,
// never the sentence itself.
function systemFor(lang) {
  const L = LANG_NAME[lang] || "English";
  return (
    "You are writing one football fan's weekly 'fan personality' card from their own match diary. " +
    "Respond ONLY with minified JSON: {\"archetype\":\"...\",\"text\":\"...\"} — no markdown, no extra keys.\n" +
    "Language: " + L + " for BOTH fields.\n" +
    "archetype: an evocative 2-3 word character title that distills HOW this person watches football " +
    "(in the spirit of 'The Goal Hunter', but invent your own from the data; never reuse these examples verbatim).\n" +
    "text: EXACTLY 2 sentences, 45 words maximum, second person. Write with feeling — what football " +
    "seems to mean to them, what they chase, what a stadium does to them — and anchor it in at most " +
    "TWO specific details from the data (a ground count, a team that keeps appearing, a harsh average, " +
    "a rainy away day). NEVER recite the stats as a list, never say 'your data shows', never invent " +
    "facts not present in the data. No greeting, no title inside text, no emoji, no bullet points. " +
    "Vary the opening — do not start with 'You are'."
  );
}

function line(arr, label, v) { if (v !== undefined && v !== null && v !== "" && v !== "?") arr.push(label + ": " + v); }

function buildContext(b) {
  const L = [];
  line(L, "Matches logged", b.logCount);
  line(L, "Watched AT the stadium", b.attendedCount);
  line(L, "Distinct grounds visited", b.stadiumCount);
  line(L, "Cities", b.cityCount);
  line(L, "Average rating (out of 5)", b.avgRating);
  line(L, "Average over the last 5 matches", b.recentAvg);
  if (Array.isArray(b.topTags) && b.topTags.length) L.push("Dominant mood tags: " + b.topTags.slice(0, 5).join(", "));
  if (b.favTeam) line(L, "Most-logged team", b.favTeam + (b.favTeamCount ? " (" + b.favTeamCount + " matches)" : ""));
  if (b.bestMatch) line(L, "Highest-rated match", b.bestMatch);
  if (b.worstMatch) line(L, "Lowest-rated match", b.worstMatch);
  line(L, "Night matches share", b.nightPct != null ? b.nightPct + "%" : null);
  line(L, "First diary entry", b.firstLogDate);
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

  const prompt = systemFor(b.lang) + "\n\nThe fan's diary data:\n" + buildContext(b);
  async function callGemini() {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // JSON mode + a hard token ceiling: the length cap is enforced twice (prompt + here), so a
        // rambling completion physically cannot come back.
        generationConfig: { temperature: 1.0, maxOutputTokens: 220, topP: 0.95, topK: 64, responseMimeType: "application/json" },
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
  let raw = (((((j || {}).candidates || [])[0] || {}).content || {}).parts || [])[0];
  raw = ((raw && raw.text) || "").trim();
  if (!raw) return Response.json({ error: "empty", text: "" });

  // JSON mode should hand back the object directly; the fallbacks cover a model that wrapped it
  // in prose anyway. Worst case the whole answer becomes the text and the archetype stays empty —
  // the app renders that fine.
  let archetype = "", text = "";
  try {
    const parsed = JSON.parse(raw);
    archetype = String(parsed.archetype || "").trim();
    text = String(parsed.text || "").trim();
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { const p2 = JSON.parse(m[0]); archetype = String(p2.archetype || "").trim(); text = String(p2.text || "").trim(); } catch (e2) {}
    }
    if (!text) text = raw;
  }
  if (!text) return Response.json({ error: "empty", text: "" });

  return Response.json({ archetype: archetype, text: text });
}
