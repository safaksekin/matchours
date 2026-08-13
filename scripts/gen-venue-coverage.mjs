// Mark which grounds in public/stadiums-world.json belong to a club whose fixtures API-Football
// ACTUALLY carries, and write that as a 6th element: [name, lat, lng, cap, teamId, covered].
//
// Run:  node --env-file-if-exists=.env.seed scripts/gen-venue-coverage.mjs
//
// WHY. gen-venues-geo.mjs builds the set from /teams?country=X, which returns every club the API
// has ever heard of — including ones in no tracked competition at all. "The API knows this club"
// and "the API has this club's fixtures" are different facts, and only the second one can put a
// match on the passport. Without knowing which is which, the app has to guess, and the guess we
// tried (stadium capacity) is wrong in both directions: Dulwich Hamlet's Champion Hill seats 3,336
// and has Isthmian League fixtures, while plenty of bigger grounds have none.
//
// So ask instead of guess: every LEAGUE the API lists for a country in its current season, then
// every team in those leagues. A club with a league has a fixture list, therefore matches.
//
// Type "League" only, cups deliberately excluded. A cup's team list includes everyone who entered,
// and at the amateur end that is a long tail of clubs with no scheduled football at all: University
// College London appears solely in the Premier League Cup (an academy competition) and The Beehive's
// club solely in the FA Cup as a qualifying-round entrant — neither has a single upcoming fixture,
// yet counting cups marked both "covered" and they went straight back to crowding out Stamford
// Bridge. Clubs that genuinely play, at any level, are in a league: Dulwich Hamlet and Carshalton
// Athletic come through on Non League Premier - Isthmian, which is exactly the depth we want.
// Their cup ties are not lost either — the fixture lookup finds whatever is next at the ground,
// league or cup; this flag only decides which grounds are worth ASKING about.
//
// ~800 calls (one per country + one per league), a few minutes. Rerun whenever the season turns:
// promotion, relegation and new entrants all move clubs in and out of coverage.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }

const EURO_CC = new Set([
  'AL','AD','AT','AZ','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','GE','DE','GI','GR',
  'HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO',
  'SM','RS','SK','SI','ES','SE','CH','TR','UA',
]);
const UK_NAMES = { england: 1, scotland: 1, wales: 1, 'northern-ireland': 1, 'northern ireland': 1 };

const WORLD_PATH = 'public/stadiums-world.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    let j = null;
    try {
      const res = await fetch('https://v3.football.api-sports.io' + path, { headers: { 'x-apisports-key': KEY } });
      j = await res.json();
    } catch (e) { /* network blip → retry */ }
    const errs = j && j.errors;
    const hasErr = errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
    if (j && !hasErr) return j;
    const msg = hasErr ? JSON.stringify(errs) : 'network';
    const wait = /minute|second|Too many/i.test(msg) ? 61000 : 3000 * (i + 1);
    console.log('  api retry (' + msg.slice(0, 70) + ') — waiting ' + Math.round(wait / 1000) + 's');
    await sleep(wait);
  }
  return null;
}

const cj = await apiGet('/countries');
if (!cj) { console.error('cannot list countries'); process.exit(1); }
const countries = (cj.response || [])
  .filter((c) => UK_NAMES[String(c.name).toLowerCase()] || EURO_CC.has(c.code))
  .map((c) => c.name);
console.log('countries: ' + countries.length);

const covered = new Set();
let leagueCount = 0;
for (const country of countries) {
  // current=true, not a hard-coded year: European leagues split the calendar and the Nordic ones
  // don't, so "this season" is per-league. The API answers with each league's own current season.
  const lj = await apiGet('/leagues?current=true&country=' + encodeURIComponent(country));
  await sleep(250);
  const leagues = (lj && lj.response) || [];
  let added = 0;
  for (const L of leagues) {
    const id = L.league && L.league.id;
    const season = (L.seasons && L.seasons[0] && L.seasons[0].year);
    if (!id || season == null) continue;
    if ((L.league.type || '') !== 'League') continue; // cups add entrants that never get a fixture
    leagueCount++;
    const tj = await apiGet('/teams?league=' + id + '&season=' + season);
    await sleep(250);
    for (const t of (tj && tj.response) || []) {
      const tid = t.team && t.team.id;
      if (tid && !covered.has(tid)) { covered.add(tid); added++; }
    }
  }
  console.log(country + ': ' + leagues.length + ' leagues, +' + added + ' clubs (total ' + covered.size + ')');
}

const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));
let on = 0, off = 0;
for (const e of world) {
  const tid = e.length > 4 ? e[4] : null;
  const flag = tid && covered.has(tid) ? 1 : 0;
  if (e.length > 5) e[5] = flag; else if (e.length > 4) e.push(flag);
  if (flag) on++; else off++;
}
fs.writeFileSync(WORLD_PATH, JSON.stringify(world));
console.log('DONE. leagues=' + leagueCount + ' covered-clubs=' + covered.size +
            ' | grounds flagged covered=' + on + ', not covered=' + off + ' of ' + world.length);
