// Re-geocode the grounds audit-venue-coords.mjs flagged, and keep the answer only when it is better.
//
// Run:  node --env-file-if-exists=.env.seed scripts/fix-venue-coords.mjs        (dry run, prints)
//       WRITE=1 node --env-file-if-exists=.env.seed scripts/fix-venue-coords.mjs (writes the file)
//
// WHY a second query helps. gen-venues-geo.mjs asks Nominatim for the ground BY NAME, and stadium
// names are not unique: "Memorial Stadium" is Bristol Rovers' ground and also one in Seattle, and
// the geocoder has no way to know which we meant. The API, however, tells us the club's city — so
// asking again as "<venue>, <city>, <country>" is a different, far better-constrained question.
//
// WHY the answer is still checked. A second guess can be wrong too, so nothing is trusted on faith:
// a new point replaces the old one only if it lands inside its own country's spread (the same
// median test the audit uses). That has a deliberate side effect — the audit's false alarms are
// safe to feed in. Tenerife and Martinique grounds are correctly placed but far from their
// country's centre, so their re-geocode fails the test too and the existing (correct) coordinates
// simply stay. The rule "only accept a clear improvement" makes the tool safe on a dirty list.
//
// Nominatim politeness: 1.1s between queries, same as the generator.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }
const WRITE = process.env.WRITE === '1';

const WORLD_PATH = 'public/stadiums-world.json';
const CC_PATH = 'scripts/venues-country-cache.json';
const BASE_KM = 300;
const UA = 'stadory-venue-fix/1.0 (safaksekin@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371, rad = (d) => d * Math.PI / 180;
const hav = (a, b, c, d) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// The API returns HTML entities in place names ("Bo&apos;ness"), which a geocoder reads as literal text.
const unent = (s) => (s || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

if (!fs.existsSync(CC_PATH)) { console.error('run scripts/audit-venue-coords.mjs first (builds ' + CC_PATH + ')'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(CC_PATH, 'utf8')).meta || {};
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));

// Same grouping + limits as the audit, so "suspect" means exactly what it meant there.
const byCountry = {};
for (const e of world) {
  const m = e.length > 4 && e[4] ? meta[e[4]] : null;
  if (!m) continue;
  (byCountry[m.country] = byCountry[m.country] || []).push({ e, m });
}
const centres = {};
for (const [country, rows] of Object.entries(byCountry)) {
  if (rows.length < 5) continue;
  const lat = median(rows.map((r) => r.e[1])), lng = median(rows.map((r) => r.e[2]));
  const ds = rows.map((r) => hav(lat, lng, r.e[1], r.e[2])).sort((a, b) => a - b);
  centres[country] = { lat, lng, limit: Math.max(BASE_KM, (ds[Math.floor(ds.length * 0.9)] || 0) * 3) };
}

const suspects = [];
for (const [country, rows] of Object.entries(byCountry)) {
  const c = centres[country];
  if (!c) continue;
  for (const r of rows) {
    const km = hav(c.lat, c.lng, r.e[1], r.e[2]);
    if (km > c.limit) suspects.push({ ...r, country, km, c });
  }
}
console.log('suspects to re-query: ' + suspects.length + '\n');

// Returns the top hit AND whether the query was ambiguous — several matches scattered across the
// map. Ambiguity is the whole problem this script exists to fix, so it must not be thrown away by
// asking for limit=1: "Saint-Joseph, France" has a dozen answers and picking the first is a coin
// flip that happens to look like a result.
async function geocode(q, n = 5) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=' + n + '&q=' + encodeURIComponent(q);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.length) return null;
    const pts = j.map((r) => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));
    const spread = Math.max(...pts.map((p) => hav(pts[0].lat, pts[0].lng, p.lat, p.lng)));
    return { ...pts[0], spread, n: pts.length };
  } catch (e) { return null; }
}

// The country as the API spells it is not the country a geocoder knows: "Northern-Ireland" with a
// hyphen matches nothing, and the API sometimes files a club under the wrong country outright
// (Sarpsborg in "Ireland", a Chilean ground in "Italy"). Where the name is wrong, dropping it is
// better than sending it — the venue and city still carry the query.
const COUNTRY_FIX = { 'Northern-Ireland': 'Northern Ireland', 'Czech-Republic': 'Czechia', 'San-Marino': 'San Marino' };
const countryQ = (c) => COUNTRY_FIX[c] || c;

// Queries from most specific to least. The API's city field often carries a county too
// ("Bristol, Gloucestershire") and that extra term alone was enough to make Nominatim give up, so
// the town on its own gets a turn. The last resort is the town centre with no venue at all: for a
// 45km destination radius and a nearest-grounds sort, the right town beats the wrong continent by a
// distance no map pin error comes close to — but it IS approximate, so it says so in the output.
//
// What is deliberately NOT here: a query without the city. "Stade Municipal, France" and "Estadio
// Los Pinos, Spain" both return confident answers to a question nobody asked — a random municipal
// ground in Ain, a park near Madrid — and they land inside the country, so every cheap sanity check
// waves them through. The city is the only thing that makes the question specific, so a query
// without it is not run at all.
function queriesFor(venue, city, country) {
  const town = (city || '').split(',')[0].trim();
  const cq = countryQ(country);
  const qs = [];
  if (venue && city) qs.push({ q: [venue, city, cq].filter(Boolean).join(', '), exact: true });
  if (venue && town && town !== city) qs.push({ q: [venue, town, cq].filter(Boolean).join(', '), exact: true });
  if (town) qs.push({ q: town + ', ' + cq, exact: false });
  return qs;
}
// How far apart a query's several answers may sit before we call it ambiguous and refuse it. The
// grounds this rejects are the ones that matter: France's overseas clubs are filed under "France",
// so "Sainte-Marie, France" offers a Pyrenean village and a Martinique town with equal confidence —
// and the Martinique coordinates already in the file are the CORRECT ones. Accepting the mainland
// answer there would not be a fix, it would be this script inventing an error where none existed.
const AMBIGUOUS_KM = 40;

let fixed = 0, approx = 0, nohit = 0;
for (const s of suspects) {
  const city = unent(s.m.city), venue = unent(s.m.venue || s.e[0]);
  let hit = null, q = '', exact = true;
  for (const cand of queriesFor(venue, city, s.country)) {
    const r = await geocode(cand.q);
    await sleep(1100);
    if (!r) continue;
    // Two independent hurdles, and a candidate has to clear both.
    // 1. Unambiguous — one place, not a name shared by several.
    if (r.n > 1 && r.spread > AMBIGUOUS_KM) continue;
    // 2. Inside the country. A specific query that answers with the wrong continent is worth no
    //    more than a vague one; this is what rejects the mainland answer for an overseas club.
    if (hav(s.c.lat, s.c.lng, r.lat, r.lng) > s.c.limit) continue;
    hit = r; q = cand.q; exact = cand.exact;
    break;
  }
  // Nothing came back inside the country. Two very different situations land here and both want the
  // same treatment: a genuinely remote-but-correct ground (Tenerife, Martinique) whose re-query is
  // rightly rejected, and one the geocoder simply cannot find. Leave the file alone either way.
  if (!hit) { nohit++; console.log(`  =  ${s.e[0]} (${s.country}) — nothing better found, left as is`); continue; }
  const km = hav(s.c.lat, s.c.lng, hit.lat, hit.lng);
  console.log(`  ${exact ? '→' : '~'}  ${s.e[0]} (${s.country})${exact ? '' : '  [town centre, approximate]'}`);
  console.log(`       was ${s.e[1].toFixed(4)},${s.e[2].toFixed(4)}  (${s.km.toFixed(0)}km out)`);
  console.log(`       now ${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}  (${km.toFixed(0)}km out)   via "${q}"`);
  s.e[1] = hit.lat; s.e[2] = hit.lng;
  if (exact) fixed++; else approx++;
}

console.log(`\nfixed=${fixed} approximate=${approx} no-result=${nohit}`);
fixed += approx;
if (fixed && WRITE) { fs.writeFileSync(WORLD_PATH, JSON.stringify(world)); console.log('wrote ' + WORLD_PATH); }
else if (fixed) console.log('DRY RUN — re-run with WRITE=1 to save');
