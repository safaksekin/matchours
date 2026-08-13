// Find grounds in public/stadiums-world.json that were geocoded to the WRONG PLACE.
//
// Run:  node --env-file-if-exists=.env.seed scripts/audit-venue-coords.mjs
//
// WHY. gen-venues-geo.mjs asks Nominatim for a ground by name, and a name is not a unique key. Ask
// for "Peninsula Stadium" and you can get Salford's ground in Manchester or something in Woolwich —
// the answer looks like a success either way, so the bad one lands in the file and stays there.
// Found in the wild: Salford City's Peninsula Stadium sitting at 51.50/0.00, which put a League Two
// match 300km from where it is played into a London trip search.
//
// HOW. The API tells us which country each club is in, so a ground can be checked against the
// company it keeps: take every ground of one country, find the MEDIAN point (median, not mean — one
// stray ground in Argentina would drag a mean across the Atlantic and hide itself), then measure
// each ground against it. A ground far outside its own country's spread is either mis-geocoded or a
// club that plays abroad, and the report says which is which by printing the API's own venue city
// next to our coordinates.
//
// Reports only — the ground file is never written. Fixing is a judgement call per ground: correct
// the entry by hand, or delete the geocode-cache key and let the generator retry it.
//
// The club→country map IS cached (scripts/venues-country-cache.json), because it is the slow half —
// several hundred paged calls — and it barely changes between runs. First run a few minutes, every
// run after that seconds. Delete the cache file to force a fresh pull.

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
// How far from its country's median a ground may sit before we call it suspect. Generous on purpose:
// this is a list a human reads, and a false alarm costs a glance while a miss costs a wrong match in
// a trip search. Big countries get more room — Norway is 1,700km end to end, Malta is 27.
const BASE_KM = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371, rad = (d) => d * Math.PI / 180;
const hav = (a, b, c, d) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

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
    await sleep(/minute|second|Too many/i.test(msg) ? 61000 : 3000 * (i + 1));
  }
  return null;
}

// teamId → { country, city, venue }. Cached per country so an interrupted run resumes where it
// stopped instead of re-buying the same few hundred calls.
const CC_PATH = 'scripts/venues-country-cache.json';
const cache = fs.existsSync(CC_PATH) ? JSON.parse(fs.readFileSync(CC_PATH, 'utf8')) : { done: [], meta: {} };
const done = new Set(cache.done || []);
const meta = cache.meta || {};

if (done.size < 51) {
  const cj = await apiGet('/countries');
  if (!cj) { console.error('cannot list countries'); process.exit(1); }
  const countries = (cj.response || [])
    .filter((c) => UK_NAMES[String(c.name).toLowerCase()] || EURO_CC.has(c.code))
    .map((c) => c.name);
  let i = 0;
  for (const country of countries) {
    i++;
    if (done.has(country)) { console.log(`[${i}/${countries.length}] ${country} — cached`); continue; }
    // No `page` param. /teams returns a country's whole club list in one response and REJECTS
    // paging outright ("The Page field do not exist"), which reads as an empty country rather than
    // an error — an earlier version of this script paged and quietly audited nothing at all.
    const tj = await apiGet('/teams?country=' + encodeURIComponent(country));
    await sleep(250);
    let added = 0;
    for (const t of (tj && tj.response) || []) {
      const id = t.team && t.team.id;
      if (id) { meta[id] = { country, city: (t.venue && t.venue.city) || '', venue: (t.venue && t.venue.name) || '' }; added++; }
    }
    done.add(country);
    fs.writeFileSync(CC_PATH, JSON.stringify({ done: [...done], meta }));
    console.log(`[${i}/${countries.length}] ${country} — ${added} clubs (total ${Object.keys(meta).length})`);
  }
}
console.log('\nteams with a country: ' + Object.keys(meta).length);

const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));
const byCountry = {};
for (const e of world) {
  const m = e.length > 4 && e[4] ? meta[e[4]] : null;
  if (!m) continue;
  (byCountry[m.country] = byCountry[m.country] || []).push({ e, m });
}

const suspects = [];
for (const [country, rows] of Object.entries(byCountry)) {
  if (rows.length < 5) continue; // too few grounds for a median to mean anything
  const mLat = median(rows.map((r) => r.e[1])), mLng = median(rows.map((r) => r.e[2]));
  // The country's own spread sets the bar: measure the typical ground's distance from the median and
  // allow a wide multiple of it. A hard number would flag half of Norway and none of Malta.
  const ds = rows.map((r) => hav(mLat, mLng, r.e[1], r.e[2])).sort((a, b) => a - b);
  const p90 = ds[Math.floor(ds.length * 0.9)] || 0;
  const limit = Math.max(BASE_KM, p90 * 3);
  for (const r of rows) {
    const km = hav(mLat, mLng, r.e[1], r.e[2]);
    if (km > limit) suspects.push({ country, km, limit, name: r.e[0], lat: r.e[1], lng: r.e[2], teamId: r.e[4], city: r.m.city, venue: r.m.venue });
  }
}

suspects.sort((a, b) => b.km - a.km);
console.log('\nSUSPECT GROUNDS: ' + suspects.length + ' of ' + world.length + '\n');
for (const s of suspects) {
  console.log(`${s.km.toFixed(0)}km from ${s.country}'s centre (limit ${s.limit.toFixed(0)}km)`);
  console.log(`  "${s.name}"  ${s.lat.toFixed(4)},${s.lng.toFixed(4)}  team=${s.teamId}`);
  console.log(`  API says: ${s.venue || '?'} in ${s.city || '?'}, ${s.country}`);
  console.log(`  https://www.google.com/maps?q=${s.lat},${s.lng}`);
}
