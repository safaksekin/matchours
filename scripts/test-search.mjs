// scripts/test-search.mjs
// End-to-end check of the search stack WITHOUT an API key: feeds API-Football-shaped
// payloads through the real seeder mapping (scripts/seed-search.mjs), upserts them
// with the real search_upsert(), and asserts the ranking that search_all() produces.
//
// Every case below is a search that used to be wrong. Run it against any Postgres
// that has supabase/migrate-search-index.sql applied:
//
//   PGURI="postgres://postgres@/postgres?host=/tmp/pgs&port=55432" node scripts/test-search.mjs
//
// It talks to psql rather than a driver so the repo stays dependency-free.

import { execFileSync } from "node:child_process";
import { teamRowsFrom, playerRowsFrom } from "./seed-search.mjs";

const PGURI = process.env.PGURI;
if (!PGURI) {
  console.error('set PGURI, e.g. PGURI="postgres://postgres@/postgres?host=/tmp/pgs&port=55432"');
  process.exit(1);
}
const psql = (sql) =>
  execFileSync("psql", [PGURI, "-tAF\t", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });

// ── fixtures: exactly the shape /teams and /players/squads return ────────────
const L = (id, name, pop, country, type = "League") => ({ id, name, pop, country, type, season: 2025 });

// Real competitions with the real clubs that play in them — the tier a club sits
// in IS its popularity, so a fixture that puts Norwich in the Premier League
// would be testing a world that does not exist. `pop` mirrors LEAGUE_POP.
const LEAGUES = {
  serieA:  L(135, "Serie A", 95, "Italy"),
  ucl:     L(2, "UEFA Champions League", 100, "World"),
  uecl:    L(848, "UEFA Conference League", 78, "World"),
  champ:   L(40, "Championship", 80, "England"),
  premier: L(39, "Premier League", 97, "England"),
  laliga:  L(140, "La Liga", 96, "Spain"),
  superlig:L(203, "Süper Lig", 88, "Türkiye"),
  elite:   L(103, "Eliteserien", 70, "Norway"),
  belgium2:L(145, "Challenger Pro League", null, "Belgium"), // below the tiers we curate
  wsl:     L(998, "Women's Super League", null, "England"),
  uaepro:  L(997, "UAE Pro League", null, "United-Arab-Emirates"),
  worldcup:L(1, "World Cup", 100, "World"),
  amateur: L(999, "Bölgesel Amatör Lig", null, "Türkiye"),   // unknown league -> default tier
};

const team = (id, name, country, extra = {}) => ({
  team: { id, name, country, code: extra.code || null, national: !!extra.national, logo: null },
  venue: extra.venue || {},
});

const TEAM_PAYLOAD = [
  [LEAGUES.serieA,   [team(489, "AC Milan", "Italy", { code: "MIL", venue: { id: 907, name: "San Siro", city: "Milano" } })]],
  // Seeing a club here as WELL as in its league is what lifts it above its
  // mid-table neighbours: search_upsert keeps the best tier a club reaches.
  [LEAGUES.ucl,      [team(489, "AC Milan", "Italy"), team(541, "Real Madrid", "Spain"), team(157, "Bayern München", "Germany")]],
  [LEAGUES.uecl,     [team(65, "Nottingham Forest", "England")]],
  [LEAGUES.premier,  [team(65, "Nottingham Forest", "England"),
                      team(42, "Arsenal", "England", { venue: { id: 494, name: "Emirates Stadium", city: "London" } })]],
  // Arsenal Women play at the Emirates too. The side is a variant (negative
  // popularity) but the GROUND is not — this pairing is what regressed once.
  [LEAGUES.wsl,      [team(9007, "Arsenal W", "England", { venue: { id: 494, name: "Emirates Stadium", city: "London" } })]],
  [LEAGUES.uaepro,   [team(9008, "Emirates Club", "United-Arab-Emirates",
                      { venue: { id: 9500, name: "Emirates Club Stadium", city: "Ras al-Khaimah" } })]],
  [LEAGUES.champ,    [team(384, "Millwall", "England"), team(71, "Norwich", "England"),
                      team(9004, "Notts County FC", "England")]],
  [LEAGUES.laliga,   [team(541, "Real Madrid", "Spain"), team(9001, "Real Madrid Castilla", "Spain")]],
  [LEAGUES.superlig, [team(1004, "Eyüpspor", "Türkiye"), team(645, "Galatasaray", "Türkiye", { code: "GAL" }),
                      team(549, "Beşiktaş", "Türkiye")]],
  [LEAGUES.elite,    [team(331, "Molde", "Norway"), team(9002, "Molde II", "Norway")]],
  [LEAGUES.belgium2, [team(9003, "Mol", "Belgium")]],
  [LEAGUES.amateur,  [team(9005, "Hasköy Yıldızspor", "Türkiye"), team(9006, "Kırklarelispor", "Türkiye")]],
  // National sides. They ride the World Cup's tier-100 weighting, which is exactly
  // why they must NOT inherit it: on an equal name match a club has to win.
  [LEAGUES.worldcup, [team(9010, "Norway", "Norway", { national: true }),
                      team(9011, "Moldova", "Moldova", { national: true }),
                      team(9012, "England", "England", { national: true })]],
];

const SQUADS = [
  [{ ext_id: 496, name: "Juventus", popularity: 95 },
   [{ id: 1, name: "Kenan Yıldız", position: "Attacker", photo: null, age: 20 }]],
  [{ ext_id: 541, name: "Real Madrid", popularity: 100 },
   [{ id: 2, name: "Arda Güler", position: "Midfielder", photo: null, age: 21 }]],
  [{ ext_id: 50, name: "Manchester City", popularity: 97 },
   [{ id: 3, name: "Erling Haaland", position: "Attacker", photo: null, age: 25 }]],
  [{ ext_id: 9006, name: "Kırklarelispor", popularity: 40 },
   [{ id: 4, name: "Seyhan Yıldız", position: "Defender", photo: null, age: 27 },
    { id: 5, name: "Ali Arda Yıldız", position: "Midfielder", photo: null, age: 24 }]],
  [{ ext_id: 505, name: "Inter", popularity: 96 },
   [{ id: 6, name: "Hakan Çalhanoğlu", position: "Midfielder", photo: null, age: 32 }]],
  // Two unrelated players called Vinicius. The alias table in popular.js is keyed
  // by SURNAME, so matching players against it by name once handed Vinícius
  // Júnior's nicknames AND his fame rating to this one, who then won his own
  // nickname. Players must take popularity from their club and nothing else.
  [{ ext_id: 794, name: "Vinícius Júnior's club", popularity: 100 },
   [{ id: 7, name: "Vinícius Júnior", position: "Attacker", photo: null, age: 25 }]],
  [{ ext_id: 795, name: "RB Bragantino", popularity: 78 },
   [{ id: 8, name: "Vinicius", position: "Defender", photo: null, age: 26 }]],
];

// ── load through the real mapping + the real upsert ──────────────────────────
psql("truncate table search_entities cascade;");

// ONE upsert per league / per squad, exactly like the seeder. This matters: a
// single combined upsert would dedupe conflicting rows in-batch and quietly hide
// the merge rules, which is where the Emirates Stadium regression actually lived.
const upsert = (rows) =>
  rows.length && psql(`select search_upsert($json$${JSON.stringify(rows)}$json$::jsonb);`);

for (const [lg, payload] of TEAM_PAYLOAD) upsert(teamRowsFrom(lg, payload));
for (const [t, squad] of SQUADS) upsert(playerRowsFrom(t, squad));

// ── expectations: each is a query that used to return the wrong thing ────────
// [query, kind, expected top result, why it used to fail]
const CASES = [
  ["ey",         "team",   "Eyüpspor",          "2 chars: upstream needed 3, so this returned nothing"],
  ["eyup",       "team",   "Eyüpspor",          "'eyup' vs 'Eyüpspor': upstream compared diacritics literally"],
  ["mol",        "team",   "Molde",             "upstream surfaced only the Belgian club literally named Mol"],
  ["molde",      "team",   "Molde",             "senior side must outrank Molde II"],
  ["no",         "team",   "Nottingham Forest", "2 chars returned nothing"],
  ["not",        "team",   "Nottingham Forest", "fame must beat Notts County"],
  ["mil",        "team",   "AC Milan",          "upstream ranked Millwall first"],
  ["real",       "team",   "Real Madrid",       "Castilla must not win"],
  ["besiktas",   "team",   "Beşiktaş",          "ASCII query against a Turkish name"],
  ["beşiktaş",   "team",   "Beşiktaş",          "Turkish query against a Turkish name"],
  ["cimbom",     "team",   "Galatasaray",       "nickname alias"],
  ["ingiltere",  "team",   "England",           "localised alias still has to win a name only it has"],
  ["norw",       "team",   "Norwich",           "a club must outrank the national side on an equal match"],
  ["san siro",   "venue",  "San Siro",          "stadium search never existed"],
  ["emirates",   "venue",  "Emirates Stadium",  "Arsenal Women's variant marker leaked onto the ground and buried it"],
  ["arsenal",    "team",   "Arsenal",           "the women's side must not outrank the senior club"],
  ["arda",       "player", "Arda Güler",        "buried under namesakes"],
  ["kenan",      "player", "Kenan Yıldız",      "returned Seyhan Yıldız and friends instead"],
  ["yildiz",     "player", "Kenan Yıldız",      "returned Seyhan Yıldız first"],
  ["yıldız",     "player", "Kenan Yıldız",      "Turkish spelling of the same query"],
  ["calhanoglu", "player", "Hakan Çalhanoğlu",  "ASCII query, Turkish name"],
  ["haland",     "player", "Erling Haaland",    "typo: trigram rescue"],
  ["bayren",     "team",   "Bayern München",    "transposed typo: prefix backoff"],
  ["vinicius",   "player", "Vinícius Júnior",   "a namesake inherited his nicknames and fame from the alias table"],
  ["arda guler", "player", "Arda Güler",        "two-word exact"],
  ["guler arda", "player", "Arda Güler",        "reversed word order"],
];

let failed = 0;
for (const [q, kind, expected, why] of CASES) {
  const out = psql(
    `select kind, name, round(score) from search_all($q$${q}$q$, 3) order by score desc;`
  ).trim();
  const lines = out ? out.split("\n").map((l) => l.split("\t")) : [];
  const top = lines.find((l) => l[0] === kind);
  const got = top ? top[1] : null;
  const ok = expected === null ? got === null : got === expected;
  if (!ok) failed++;
  const label = `${q.padEnd(12)} ${kind.padEnd(6)}`;
  console.log(
    `${ok ? "  ok  " : "  FAIL"} ${label} -> ${got === null ? "(none)" : got}${
      ok ? "" : `   expected: ${expected === null ? "(none)" : expected}`
    }`
  );
  if (!ok) console.log(`        ${why}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
