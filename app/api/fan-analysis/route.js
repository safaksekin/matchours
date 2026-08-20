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

// The first BALANCED {...} in a string — brace-counting, and blind to braces inside string values
// so a quoted "{" in the portrait cannot end the object early. Returns null when there is no
// complete object (a truncated completion), which is the caller's cue to fall back rather than
// hand back half a payload.
function firstJsonObject(s) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
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

  // JSON mode USUALLY hands back the object directly, but not always: seen in production (twice on
  // 2026-08-19), the model appended a stray closing brace —
  //     {"archetype":"Karakter Avcısı","text":"…"}\n}
  // — which is not valid JSON, so the strict parse threw. The old fallback then made it worse: its
  // regex `\{[\s\S]*\}` is GREEDY, so it ran from the first `{` to the LAST `}` and dutifully
  // re-selected the same malformed string, failed again, and fell through to `text = raw`. The card
  // then rendered the raw JSON at the user, archetype blank. Scanning for the first BALANCED object
  // instead stops at the brace that actually closes it and ignores the trailing junk entirely.
  let archetype = "", text = "";
  const obj = firstJsonObject(raw);
  if (obj) {
    try {
      const p = JSON.parse(obj);
      archetype = String(p.archetype || "").trim();
      text = String(p.text || "").trim();
    } catch (e) {}
  }
  // Last resort: pull the field out by hand. Whatever happens, the user must never be shown JSON —
  // an empty card is a bug, a card full of braces and key names is an embarrassment.
  if (!text) {
    const m = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) { try { text = JSON.parse('"' + m[1] + '"').trim(); } catch (e) { text = m[1].trim(); } }
    if (!archetype) {
      const a = raw.match(/"archetype"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (a) { try { archetype = JSON.parse('"' + a[1] + '"').trim(); } catch (e) { archetype = a[1].trim(); } }
    }
  }
  // Still nothing structured: only accept the raw completion if it does not look like JSON.
  if (!text && raw.indexOf("{") < 0) text = raw;
  if (!text) return Response.json({ error: "empty", text: "" });

  return Response.json({ archetype: archetype, text: text });
}
