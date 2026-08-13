// Check every ground against the TOWN the API says its club plays in — the resolution the app
// actually works at.
//
// Run:  GEONAMES=/path/to/cities500.txt node --env-file-if-exists=.env.seed scripts/audit-venue-cities.mjs
//       (get the file from https://download.geonames.org/export/dump/cities500.zip — free, ~10MB)
//
// WHY, given audit-venue-coords.mjs already exists. That one compares a ground to its COUNTRY's
// median, which only ever catches a ground on the wrong continent. Everything this app does is
// city-scale: the trip planner takes a 45km radius, the nearby feed sorts by kilometres. A ground
// misplaced by 300km inside its own country is invisible to a country-level check and completely
// broken for both features — Salford City's Peninsula Stadium sat in south-east London, close
// enough to England's median to pass, and put a Manchester fixture into London trip searches.
//
// WHY a downloaded gazetteer instead of geocoding. 5,137 distinct towns at Nominatim's one-request-
// per-second politeness rate is an hour and a half, every time anyone wants to check. The same
// answers ship as a 10MB file that makes the whole audit run in seconds and costs no one a request.
// This is a check that should be cheap enough to run after every regeneration, and now it is.
//
// Reports only — nothing is written. Feed what it finds to scripts/fix-venue-coords.mjs, or correct
// entries by hand.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }
const GEO = process.env.GEONAMES;
if (!GEO || !fs.existsSync(GEO)) { console.error('GEONAMES=<path to cities500.txt> required'); process.exit(1); }

const WORLD_PATH = 'public/stadiums-world.json';
const CC_PATH = 'scripts/venues-country-cache.json';
// How far a ground may sit from its town centre before it is called suspect. Generous: a big city's
// grounds are genuinely spread out (a London club can be 25km from Charing Cross), the gazetteer's
// point is a centroid, and a false alarm only costs a line in a report. What this must catch is the
// order-of-magnitude error — the ground in the wrong town, county or country.
const LIMIT_KM = 60;

const R = 6371, rad = (d) => d * Math.PI / 180;
const hav = (a, b, c, d) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const unent = (s) => (s || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const norm = (s) => unent(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The gazetteer is keyed by country CODE, the API answers with country NAMES, so the two need
// introducing. The UK is the awkward one: England, Scotland, Wales and Northern Ireland are four
// countries to a football API and one ("GB") to a geographer, so they all map to GB and the town
// name alone has to carry the distinction.
const cj = await (await fetch('https://v3.football.api-sports.io/countries', { headers: { 'x-apisports-key': KEY } })).json();
const codeOf = {};
for (const c of cj.response || []) if (c.code) codeOf[c.name] = c.code;
for (const n of ['England', 'Scotland', 'Wales', 'Northern-Ireland']) codeOf[n] = 'GB';

// name+country → the most populous place with that name. Population as the tie-break because the
// alternative is arbitrary: there are five Springfields and the club is almost always in the one
// people have heard of. Alternate names are indexed too — the API writes "München", the gazetteer's
// primary is "Munich".
const places = {};
for (const line of fs.readFileSync(GEO, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const lat = parseFloat(f[4]), lng = parseFloat(f[5]), cc = f[8], pop = parseInt(f[14], 10) || 0;
  if (!cc || !isFinite(lat)) continue;
  const names = [f[1], f[2]].concat((f[3] || '').split(',')).filter(Boolean);
  for (const n of names) {
    const k = cc + '|' + norm(n);
    if (!k.endsWith('|') && (!places[k] || places[k].pop < pop)) places[k] = { lat, lng, pop, name: f[1] };
  }
}
console.log('gazetteer places indexed: ' + Object.keys(places).length);

const meta = JSON.parse(fs.readFileSync(CC_PATH, 'utf8')).meta || {};
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));

let checked = 0, noCity = 0, noPlace = 0;
const suspects = [];
for (const e of world) {
  const m = e.length > 4 && e[4] ? meta[e[4]] : null;
  if (!m || !m.city) { noCity++; continue; }
  const cc = codeOf[m.country];
  // The API's city field often carries a county as well ("Bristol, Gloucestershire"); the town is
  // the part the gazetteer knows.
  const town = unent(m.city).split(',')[0].trim();
  const p = cc && places[cc + '|' + norm(town)];
  if (!p) { noPlace++; continue; }
  checked++;
  const km = hav(p.lat, p.lng, e[1], e[2]);
  if (km > LIMIT_KM) suspects.push({ km, name: e[0], lat: e[1], lng: e[2], teamId: e[4], town, country: m.country, apiVenue: m.venue, p });
}

suspects.sort((a, b) => b.km - a.km);
console.log(`checked ${checked} grounds against their town  (no city from API: ${noCity}, town not in gazetteer: ${noPlace})`);
console.log(`\nSUSPECT GROUNDS: ${suspects.length}\n`);
for (const s of suspects) {
  console.log(`${s.km.toFixed(0)}km from ${s.town}, ${s.country}`);
  console.log(`  "${s.name}"  ${s.lat.toFixed(4)},${s.lng.toFixed(4)}  team=${s.teamId}`);
  console.log(`  API venue: ${s.apiVenue || '?'}   town centre: ${s.p.lat.toFixed(4)},${s.p.lng.toFixed(4)}`);
  console.log(`  https://www.google.com/maps?q=${s.lat},${s.lng}`);
}
