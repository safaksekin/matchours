// scripts/seed-search.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Fills the Postgres search index (see supabase/migrate-search-index.sql) from
// API-Football, so that typeahead never touches API-Football again.
//
//   APISPORTS_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-search.mjs --budget 500
//
// Four stages, cheapest and most valuable first:
//   1. leagues  1 call            -> every competition + its current season
//   2. teams    1 call per league -> every club/national side, WITH its league,
//                                    which is where popularity comes from
//   3. squads   1 call per team   -> current players of teams above --min-pop
//   4. names    ~2.7k calls       -> real first names; /players/squads abbreviates
//                                    exactly the famous ones ("K. Yıldız")
//
// BUDGETED AND RESUMABLE. Every unit of work records itself in search_sync_state,
// and the run stops cleanly when it hits --budget API calls, so this works on a
// 100-calls/day plan (run it daily until it reports nothing left) exactly as well
// as on an unmetered one. Work is ordered by popularity, so even a truncated run
// leaves the index useful: the Champions League is indexed before the Faroese
// second division.
//
// Re-running is also how the index STAYS fresh — anything synced within
// --max-age days is skipped, so a nightly `--budget 200` run rolls through
// transfers on its own.
// ─────────────────────────────────────────────────────────────────────────────

import process from "node:process";
import { pathToFileURL } from "node:url";
import { SEARCH_ALIASES } from "../app/lib/searchAliases.js";

// ── config ──────────────────────────────────────────────────────────────────
const API = "https://v3.football.api-sports.io";
const KEY = process.env.APISPORTS_KEY;
const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
};
const num = (name, dflt) => {
  const v = flag(name, null);
  return v === null || v === true ? dflt : Number(v);
};

const OPT = {
  budget: num("budget", 4000),        // hard cap on API-Football calls this run
  stage: String(flag("stage", "all")), // all | leagues | teams | squads | names
  minPop: num("min-pop", 58),          // only index squads of teams at/above this fame
  maxAge: num("max-age", 30),          // days before a scope is re-synced
  rps: num("rps", 4),                  // API-Football requests per second
  chunk: num("chunk", 400),            // rows per search_upsert call
  dry: flag("dry", false) === true,
};

// ── popularity model ────────────────────────────────────────────────────────
// The ONLY place fame is decided. It is structural, not a celebrity list: a club
// inherits the best competition it appears in, and a player inherits his club.
// That is why "mil" ranks AC Milan over Millwall and "yildiz" ranks Kenan Yıldız
// over an amateur namesake without either name being mentioned anywhere.
//
// Because search_upsert() keeps the GREATEST popularity per entity, clubs that
// also play in Europe are lifted automatically — Champions League participation
// separates Real Madrid from a mid-table La Liga side at no extra cost.
const LEAGUE_POP = {
  // international
  1: 100, 2: 100, 4: 98, 9: 92, 15: 90, 3: 88, 13: 84, 5: 82, 6: 80, 848: 78, 7: 76, 11: 70,
  // top domestic
  39: 97, 140: 96, 135: 95, 78: 95, 61: 92, 203: 88, 88: 84, 94: 84,
  40: 80, 307: 80, 71: 78, 128: 78, 253: 78, 262: 76, 144: 76, 179: 74,
  98: 72, 197: 72, 207: 72, 218: 72, 235: 72, 119: 70, 103: 70, 113: 70,
  292: 68, 106: 68, 333: 68, 345: 66, 210: 66, 286: 66, 169: 64,
  // second tiers of the majors
  79: 66, 141: 64, 136: 64, 62: 62, 204: 62, 41: 58, 42: 52,
};
const DEFAULT_LEAGUE_POP = 40; // any other domestic league
const DEFAULT_CUP_POP = 34;    // any other cup

// National sides get a FLAT rating that deliberately ignores the tournament they
// appear in. Inheriting it like a club does would give every World Cup qualifier
// 100 — level with Real Madrid — and that is how "no" came to answer Norway ahead
// of Nottingham Forest and "mol" Moldova ahead of Molde. This is a club app: on
// an equal name match the club should win. 62 sits above the lower divisions
// (40) and below every curated top flight (52+), so nations still beat obscure
// clubs and still win outright on a name only they have ("ingiltere", "arjantin").
const NATIONAL_POP = 62;

export const leaguePopOf = (league) =>
  LEAGUE_POP[league.id] ?? (league.type === "League" ? DEFAULT_LEAGUE_POP : DEFAULT_CUP_POP);

// Reserve / youth / women / academy sides. They must stay searchable (you can log
// a match at one) but must never outrank the senior club, so they get a negative
// popularity, which search_all() treats as a classification that always sticks.
const VARIANT_RE =
  /(\bU\s?\d{2}\b|\bU-\d{2}\b|\bwomen\b|\bfemen|\bfeminin|\b[wW]\b|\bII\b|\bB\b|reserve|youth|academy|castilla|juvenil|sub\s?\d{2})/i;
export const isVariant = (name) => VARIANT_RE.test(name || "");

// CLUBS ONLY. The dictionary is keyed by full club name, which is distinctive;
// there is no player equivalent because personal names are not (see the note on
// playerRowsFrom). `boost` is a fame FLOOR for the few clubs whose league tier
// understates them — Inter Miami in MLS, Al Nassr in the Saudi league.
export function withAliases(name, base, extra) {
  const rec = SEARCH_ALIASES.teams[name] || null;
  const aliases = new Set(extra || []);
  if (rec) (rec.a || []).forEach((a) => aliases.add(a));
  const pop = base < 0 ? base : Math.max(base, rec && rec.boost ? rec.boost : 0);
  return { aliases: [...aliases], popularity: Math.max(-32, Math.min(100, Math.round(pop))) };
}

// A squad entry carries a DISPLAY name; a profile carries firstname + lastname.
// Neither alone is right:
//   squads   "T. Courtois"   -> the first name is unsearchable
//   profiles "Thibaut Nicolas Marc Courtois" -> the full legal name, which nobody
//            types, reads badly in a result row, and dilutes ranking (more words
//            means the query matches a later position and loses the length tiebreak)
// So: keep the squad name when it is already a real name ("Vinícius Júnior",
// "Bremer", "Kylian Mbappé"), and only when it is abbreviated compose a natural
// one from the profile — FIRST given name plus surname. Both discarded spellings
// are kept as aliases, so "t courtois" and "paixao" still match.
const ABBREVIATED_RE = /(^|\s)\p{L}\.(\s|$)/u;
const INITIAL_RE = /(^|\s)(\p{L})\./u;

export function displayName(p) {
  const squad = (p.name || "").trim();
  const givens = String(p.firstname || "").trim().split(/\s+/).filter(Boolean);
  const last = String(p.lastname || "").trim();
  const full = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();

  // Which given name does he actually go by? The abbreviation says so: the "K."
  // in "K. Aktürkoğlu" picks Kerem out of "Muhammed Kerem", where blindly taking
  // the first given name would have produced "Muhammed Aktürkoğlu" — a real name
  // for a player nobody calls that. Falls back to the first given name.
  const initial = (squad.match(INITIAL_RE) || [])[2];
  const byInitial = initial
    ? givens.find((g) => g[0].toLocaleLowerCase("tr") === initial.toLocaleLowerCase("tr"))
    : null;
  const first = byInitial || givens[0] || "";
  const natural = [first, last].filter(Boolean).join(" ").trim();

  const name = squad && !ABBREVIATED_RE.test(squad) ? squad : natural || squad;
  if (!name) return null;

  const aliases = [squad, full, natural].filter(
    (a, i, arr) => a && a !== name && arr.indexOf(a) === i
  );
  // nothing to add and nothing to rename -> skip the write entirely
  if (name === squad && !aliases.length) return null;
  return { name, aliases };
}

// ── API payload -> index rows ───────────────────────────────────────────────
// Pure, so the mapping that decides every ranking outcome can be tested without
// an API key (see scripts/test-search.mjs).

// /teams?league=&season= -> team + venue rows, in the context of that league.
export function teamRowsFrom(lg, apiTeams) {
  const rows = [];
  for (const item of apiTeams || []) {
    const t = item.team || {};
    const v = item.venue || {};
    if (!t.id || !t.name) continue;

    const base = isVariant(t.name) ? -30 : t.national ? NATIONAL_POP : lg.pop;
    const { aliases, popularity } = withAliases(t.name, base, t.code ? [t.code] : []);
    rows.push({
      kind: "team",
      ext_id: t.id,
      name: t.name,
      subtitle: t.country || lg.country || null,
      image: t.logo || null,
      country: t.country || lg.country || null,
      aliases,
      popularity,
      meta: { national: !!t.national, leagueId: lg.id, venueId: v.id || null },
    });

    // Venues ride along free — same payload, and "stadory" is a ground-logging
    // app, so searching a stadium by name has to work.
    //
    // FLOORED AT ZERO, never negative. A negative popularity marks an entity as a
    // reserve/youth/women SIDE, and that is a property of the side itself — it
    // must not travel down to the ground it happens to play on. Arsenal Women
    // play at the Emirates; without this floor their -30 propagated to the
    // stadium and, because search_upsert makes a negative permanent, it stuck
    // there and buried the real Emirates under a club ground in Ras al-Khaimah.
    if (v.id && v.name) {
      rows.push({
        kind: "venue",
        ext_id: v.id,
        name: v.name,
        subtitle: [v.city, t.country].filter(Boolean).join(" · ") || null,
        image: v.image || null,
        country: t.country || lg.country || null,
        aliases: [],
        popularity: Math.max(0, popularity - 12),
        meta: { city: v.city || null, capacity: v.capacity || null, teamId: t.id },
      });
    }
  }
  return rows;
}

// /players/squads?team= -> player rows. A player is as findable as the shirt he
// wears; slightly below the club so "arsenal" surfaces the club above its squad.
// NOTE: deliberately does NOT consult SEARCH_ALIASES for players. That table is
// keyed by SURNAME ("Vinicius", "Son", "Rodri", "Yildiz"), which is not a unique
// identifier for a person — matching it by name handed Vinícius Júnior's
// nicknames and his 92 fame rating to an unrelated Vinicius at RB Bragantino,
// who then outranked the real one for his own nickname. Club-derived popularity
// needs no such help, and a name dictionary that cannot tell two people apart
// does more harm than good. Clubs keep theirs: full club names are distinctive.
export function playerRowsFrom(team, squad) {
  const national = !!(team.meta && team.meta.national);
  const rows = [];
  for (const p of squad || []) {
    if (!p.id || !p.name) continue;
    const popularity = Math.max(0, Math.min(100, Math.round(team.popularity * 0.85)));
    rows.push({
      kind: "player",
      ext_id: p.id,
      name: p.name,
      // A national call-up must NOT claim the subtitle. search_upsert coalesces
      // it, so whichever squad is written last wins — and that left the row
      // reading "Arda Güler · Türkiye" when "· Real Madrid" is what tells him
      // apart from the next Arda. Nations contribute the nationality instead.
      subtitle: national ? null : team.name,
      image: p.photo || null,
      country: national ? team.name : null,
      aliases: [],
      popularity,
      meta: { teamId: team.ext_id, position: p.position || null, number: p.number ?? null, age: p.age ?? null },
    });
  }
  return rows;
}

// ── plumbing ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
let lastCall = 0;
const budgetLeft = () => OPT.budget - calls;

class BudgetExhausted extends Error {}

// `response` only — what every stage but stageNames needs.
async function api(path) {
  const j = await apiRaw(path);
  return (j && j.response) || null;
}

// The whole envelope, because the profile stage has to read `paging.total`.
async function apiRaw(path) {
  if (budgetLeft() <= 0) throw new BudgetExhausted();
  const gap = 1000 / Math.max(OPT.rps, 0.2);
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  calls++;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(API + path, { headers: { "x-apisports-key": KEY } });
    } catch {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const errs = j && j.errors;
    const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length);
    if (hasErr) {
      // API-Football reports quota exhaustion as a 200 with an `errors` body.
      const text = JSON.stringify(errs);
      if (/limit|quota|subscription/i.test(text)) {
        console.error(`\napi-football refused the call (quota/plan): ${text}`);
        throw new BudgetExhausted();
      }
      await sleep(1500);
      continue;
    }
    return j;
  }
  return null;
}

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// Supabase calls get the same retry the API-Football ones have. A run is ~40
// minutes of continuous networking; without this, one transient `fetch failed`
// throws straight out of main() and discards the rest of the pass.
async function sbFetch(url, opts) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`supabase ${res.status}`);
        await sleep(1200 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr || new Error("supabase unreachable");
}

async function upsertEntities(rows) {
  if (!rows.length) return 0;
  if (OPT.dry) return rows.length;
  let done = 0;
  for (let i = 0; i < rows.length; i += OPT.chunk) {
    const slice = rows.slice(i, i + OPT.chunk);
    const res = await sbFetch(`${SB_URL}/rest/v1/rpc/search_upsert`, {
      method: "POST",
      headers: sbHeaders,
      body: JSON.stringify({ rows: slice }),
    });
    if (!res.ok) throw new Error(`search_upsert failed (${res.status}): ${await res.text()}`);
    done += slice.length;
  }
  return done;
}

async function markSynced(scope, meta) {
  if (OPT.dry) return;
  await sbFetch(`${SB_URL}/rest/v1/search_sync_state?on_conflict=scope`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ scope, synced_at: new Date().toISOString(), status: "ok", meta: meta || {} }),
  });
}

// Scopes synced within --max-age days. Fetched once so the run makes a single
// round trip instead of one per candidate.
async function loadFreshScopes() {
  const since = new Date(Date.now() - OPT.maxAge * 86400_000).toISOString();
  const out = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await sbFetch(
      `${SB_URL}/rest/v1/search_sync_state?select=scope&status=eq.ok&synced_at=gte.${since}`,
      { headers: { ...sbHeaders, Range: `${from}-${from + pageSize - 1}` } }
    );
    if (!res.ok) break;
    const rows = await res.json();
    rows.forEach((r) => out.add(r.scope));
    if (rows.length < pageSize) break;
  }
  return out;
}

// Teams already indexed, so the squads stage knows what to walk without
// re-reading /teams. Returns [{ ext_id, name, popularity }] above --min-pop.
async function loadIndexedTeams() {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await sbFetch(
      `${SB_URL}/rest/v1/search_entities?select=ext_id,name,popularity,meta&kind=eq.team&popularity=gte.${OPT.minPop}&order=popularity.desc,ext_id.asc`,
      { headers: { ...sbHeaders, Range: `${from}-${from + pageSize - 1}` } }
    );
    if (!res.ok) throw new Error(`read search_entities failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// Ids of every player already in the index, so the profile stream can skip the
// ~95% of world football we deliberately do not carry.
async function loadIndexedPlayerIds() {
  const out = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await sbFetch(`${SB_URL}/rest/v1/search_entities?select=ext_id&kind=eq.player&order=ext_id.asc`, {
      headers: { ...sbHeaders, Range: `${from}-${from + pageSize - 1}` },
    });
    if (!res.ok) throw new Error(`read player ids failed (${res.status}): ${await res.text()}`);
    const rows = await res.json();
    rows.forEach((r) => out.add(r.ext_id));
    if (rows.length < pageSize) break;
  }
  return out;
}

// ── stages ──────────────────────────────────────────────────────────────────

// 1) Every competition, and the season we should read squads/teams for.
async function stageLeagues() {
  const data = await api("/leagues");
  if (!data) return [];
  const rows = [];
  const work = [];
  for (const item of data) {
    const l = item.league || {};
    const c = item.country || {};
    if (!l.id || !l.name) continue;
    const pop = leaguePopOf(l);
    const seasons = item.seasons || [];
    const current = seasons.find((s) => s.current) || seasons[seasons.length - 1];
    const { aliases, popularity } = withAliases(l.name, pop, c.name ? [`${l.name} ${c.name}`] : []);
    rows.push({
      kind: "league",
      ext_id: l.id,
      name: l.name,
      subtitle: c.name || null,
      image: l.logo || null,
      country: c.name || null,
      aliases,
      popularity,
      meta: { type: l.type || null, season: current ? current.year : null },
    });
    if (current) work.push({ id: l.id, name: l.name, season: current.year, pop, type: l.type, country: c.name });
  }
  await upsertEntities(rows);
  await markSynced("leagues", { count: rows.length });
  work.sort((a, b) => b.pop - a.pop || a.id - b.id);
  console.log(`  leagues: ${rows.length} indexed, ${work.length} with a current season`);
  return work;
}

// 2) Clubs + national sides + their venues, one call per league-season.
async function stageTeams(work, fresh) {
  let indexed = 0;
  let skipped = 0;
  for (const lg of work) {
    const scope = `teams:${lg.id}:${lg.season}`;
    if (fresh.has(scope)) { skipped++; continue; }
    if (budgetLeft() <= 0) throw new BudgetExhausted();

    const data = await api(`/teams?league=${lg.id}&season=${lg.season}`);
    if (!data) { await markSynced(scope, { count: 0 }); continue; }

    const rows = teamRowsFrom(lg, data);
    await upsertEntities(rows);
    await markSynced(scope, { count: rows.length });
    indexed += rows.length;
    process.stdout.write(`\r  teams: ${indexed} rows · ${calls} calls used   `);
  }
  process.stdout.write("\n");
  if (skipped) console.log(`  teams: ${skipped} league-seasons already fresh`);
  return indexed;
}

// 3) Current squads of teams worth having in a typeahead.
async function stageSquads(fresh) {
  const teams = await loadIndexedTeams();
  console.log(`  squads: ${teams.length} teams at/above popularity ${OPT.minPop}`);
  let indexed = 0;
  let skipped = 0;
  for (const t of teams) {
    const scope = `squad:${t.ext_id}`;
    if (fresh.has(scope)) { skipped++; continue; }
    if (budgetLeft() <= 0) throw new BudgetExhausted();

    const data = await api(`/players/squads?team=${t.ext_id}`);
    const rows = playerRowsFrom(t, (data && data[0] && data[0].players) || []);
    await upsertEntities(rows);
    await markSynced(scope, { count: rows.length });
    indexed += rows.length;
    process.stdout.write(`\r  squads: ${indexed} players · ${calls} calls used   `);
  }
  process.stdout.write("\n");
  if (skipped) console.log(`  squads: ${skipped} teams already fresh`);
  return indexed;
}

// 4) Real first names.
// /players/squads gives a player's DISPLAY name, and for exactly the famous ones
// that is an abbreviation: Kenan Yıldız arrives as "K. Yıldız", Arda Güler as
// "A. Güler". Indexed like that, the surname is searchable but the first name is
// not — "kenan" and "arda" find nothing, which is the whole complaint.
//
// /players/profiles carries firstname + lastname, and its unfiltered form pages
// through every player at 250 a time. Streaming ~2.7k pages and keeping only the
// ids we already hold costs an order of magnitude less than asking for each of
// our ~28k players individually. The abbreviation is kept as an alias, so both
// "k yildiz" and "kenan yildiz" still match.
async function stageNames(fresh) {
  const known = await loadIndexedPlayerIds();
  console.log(`  names: enriching ${known.size} indexed players from the profile pages`);

  // How many pages there are is only knowable from a response, so page 1 is
  // always fetched even when it is fresh. Skipping it to "save" one call would
  // leave the page count unknown and the loop with no terminating bound — which,
  // on a fully-synced re-run, means skipping forever.
  const first = await apiRaw("/players/profiles?page=1");
  if (!first) return 0;
  const total = (first.paging && first.paging.total) || 1;

  let page = 1;
  let fixed = 0;
  let res = first;
  while (page <= total) {
    const scope = `profiles:${page}`;
    if (page > 1) {
      if (fresh.has(scope)) { page++; continue; }
      if (budgetLeft() <= 0) throw new BudgetExhausted();
      res = await apiRaw(`/players/profiles?page=${page}`);
      if (!res) break;
    }

    const rows = [];
    for (const item of res.response || []) {
      const p = item.player || {};
      if (!p.id || !known.has(p.id)) continue;
      const picked = displayName(p);
      if (!picked) continue;
      rows.push({
        kind: "player",
        ext_id: p.id,
        name: picked.name,
        aliases: picked.aliases,
        country: p.nationality || null,
        // omitted on purpose: subtitle/image/meta are coalesced by search_upsert,
        // and popularity 0 loses to greatest(), so the club-derived fame survives.
        popularity: 0,
        meta: {},
      });
    }
    await upsertEntities(rows);
    await markSynced(scope, { count: rows.length });
    fixed += rows.length;
    process.stdout.write(`\r  names: ${fixed} corrected · page ${page}/${total} · ${calls} calls used   `);
    page++;
  }
  process.stdout.write("\n");
  return fixed;
}

// ── run ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!KEY || !SB_URL || !SB_KEY) {
    console.error(
      "missing env. Required: APISPORTS_KEY, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }
  const started = Date.now();
  console.log(
    `seed-search: stage=${OPT.stage} budget=${OPT.budget} min-pop=${OPT.minPop} max-age=${OPT.maxAge}d${OPT.dry ? " (dry run)" : ""}`
  );

  const fresh = await loadFreshScopes();
  let leagues = [];
  let exhausted = false;

  try {
    if (OPT.stage === "all" || OPT.stage === "leagues" || OPT.stage === "teams") {
      leagues = await stageLeagues();
    }
    if (OPT.stage === "all" || OPT.stage === "teams") {
      await stageTeams(leagues, fresh);
    }
    if (OPT.stage === "all" || OPT.stage === "squads") {
      await stageSquads(fresh);
    }
    if (OPT.stage === "all" || OPT.stage === "names") {
      await stageNames(fresh);
    }
  } catch (e) {
    if (e instanceof BudgetExhausted) exhausted = true;
    else throw e;
  }

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `\ndone in ${secs}s · ${calls} API-Football calls used` +
      (exhausted
        ? `\nSTOPPED AT BUDGET — the index is consistent as far as it got. Re-run the\n` +
          `same command to continue; already-synced work is skipped automatically.`
        : `\nnothing left to sync at --max-age ${OPT.maxAge}d.`)
  );
}

// Only run when executed directly — scripts/test-search.mjs imports the pure
// mapping functions above and must not kick off a seed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("\nseed-search failed:", e.message);
    process.exit(1);
  });
}
