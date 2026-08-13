// Repair the grounds audit-venue-cities.mjs flags: those sitting far from the town the API says
// their club plays in.
//
// Run:  GEONAMES=/path/to/cities500.txt node --env-file-if-exists=.env.seed scripts/fix-venue-cities.mjs
//       add WRITE=1 to save.
//
// Two ways a ground gets repaired, in order of preference:
//
//   1. Ask Nominatim again as "<venue>, <town>, <country>", then again for the venue alone confined
//      to a box around the town, and keep the answer if it lands within ACCEPT_KM. This is the good
//      outcome: the exact ground, correctly placed.
//   2. Otherwise fall back to the town centre from the gazetteer. Approximate — the pin sits in the
//      middle of town rather than on the pitch — but the features that consume this file work at
//      45km (trip radius) and nearest-first (the passport feed), so the right town is worth far more
//      than a precise point 250km away. Recorded as approximate in the output either way.
//
// AMBIGUOUS TOWNS ARE SKIPPED ENTIRELY, and that guard is the important one. France files its
// overseas clubs under "France", so "Sainte-Marie" is a town in Moselle and another in Martinique;
// the ground in the file is the Martinique one and it is CORRECT. A fixer that trusted the town
// name would march it 7,000km to Lorraine and call that a repair. Where a country holds two places
// of the same name far apart, this script does nothing and leaves the decision to a human.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }
const GEO = process.env.GEONAMES;
if (!GEO || !fs.existsSync(GEO)) { console.error('GEONAMES=<path to cities500.txt> required'); process.exit(1); }
const WRITE = process.env.WRITE === '1';

const WORLD_PATH = 'public/stadiums-world.json';
const CC_PATH = 'scripts/venues-country-cache.json';
const LIMIT_KM = 60;      // same bar the audit uses — what counts as "this ground is in the wrong place"
// What counts as a TRUSTWORTHY replacement, and deliberately much tighter than LIMIT_KM. Reusing 60
// here quietly accepted junk: the ground offered for Marignane sat 55km north of it, inside the bar
// but plainly not Marignane's pitch, and it was being reported as an exact hit. A ground is in its
// own town, so anything beyond a commute is the wrong ground and the town centre is the more honest
// answer — approximate, but approximately RIGHT rather than precisely wrong.
const ACCEPT_KM = 25;
const AMBIG_KM = 40;      // two same-named places further apart than this make the name unusable
const UA = 'stadory-venue-fix/1.0 (safaksekin@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371, rad = (d) => d * Math.PI / 180;
const hav = (a, b, c, d) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const unent = (s) => (s || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const norm = (s) => unent(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const cj = await (await fetch('https://v3.football.api-sports.io/countries', { headers: { 'x-apisports-key': KEY } })).json();
const codeOf = {};
for (const c of cj.response || []) if (c.code) codeOf[c.name] = c.code;
for (const n of ['England', 'Scotland', 'Wales', 'Northern-Ireland']) codeOf[n] = 'GB';

// Index as the audit does, but keep every distinct location per name so ambiguity survives to be
// tested. `best` is the most populous; `spread` is how far the runners-up sit from it.
const places = {};
for (const line of fs.readFileSync(GEO, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const lat = parseFloat(f[4]), lng = parseFloat(f[5]), cc = f[8], pop = parseInt(f[14], 10) || 0;
  if (!cc || !isFinite(lat)) continue;
  for (const n of [f[1], f[2]].concat((f[3] || '').split(',')).filter(Boolean)) {
    const nn = norm(n);
    if (!nn) continue;
    const k = cc + '|' + nn;
    const p = places[k] || (places[k] = { best: null, pts: [] });
    p.pts.push({ lat, lng });
    if (!p.best || p.best.pop < pop) p.best = { lat, lng, pop, name: f[1] };
  }
}
for (const p of Object.values(places)) p.spread = Math.max(...p.pts.map((q) => hav(p.best.lat, p.best.lng, q.lat, q.lng)));
console.log('gazetteer places indexed: ' + Object.keys(places).length);

const meta = JSON.parse(fs.readFileSync(CC_PATH, 'utf8')).meta || {};
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));

const suspects = [];
for (const e of world) {
  const m = e.length > 4 && e[4] ? meta[e[4]] : null;
  if (!m || !m.city) continue;
  const cc = codeOf[m.country];
  const town = unent(m.city).split(',')[0].trim();
  const p = cc && places[cc + '|' + norm(town)];
  if (!p) continue;
  const km = hav(p.best.lat, p.best.lng, e[1], e[2]);
  if (km > LIMIT_KM) suspects.push({ e, m, town, country: m.country, km, p });
}
suspects.sort((a, b) => b.km - a.km);
console.log('suspects: ' + suspects.length + '\n');

// `box` confines the search to a window around the town. Without it a bare venue name is a global
// question and the answer is whichever "Stadio Comunale" the ranker liked best; with it, the same
// name becomes "the one near this town", which is the question we actually have. It is what lifts
// most of these from a town-centre approximation to the real pitch.
// Every geocoder answer is cached, hits and misses alike. Tuning the acceptance rules means running
// this again, and without a cache each pass is another quarter of an hour of politeness delays for
// answers we already have.
const GC_PATH = 'scripts/venues-city-geo-cache.json';
const gcache = fs.existsSync(GC_PATH) ? JSON.parse(fs.readFileSync(GC_PATH, 'utf8')) : {};
let gdirty = 0;
// Set when the last call actually went to the network, so the caller can skip the politeness delay
// on a cache hit — a fully cached re-run finishes in a second instead of a quarter of an hour.
let hitNetwork = false;
async function geocode(q, box) {
  const key = q + (box ? '|box' : '');
  hitNetwork = false;
  if (key in gcache) return gcache[key];
  hitNetwork = true;
  const bounded = box ? `&bounded=1&viewbox=${box.w},${box.n},${box.e},${box.s}` : '';
  const put = (v) => {
    gcache[key] = v;
    if (++gdirty % 20 === 0) fs.writeFileSync(GC_PATH, JSON.stringify(gcache));
    return v;
  };
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q) + bounded, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null; // transient — not cached, so a later run retries it
    const j = await res.json();
    if (!j || !j.length) return put(null);
    return put({ lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) });
  } catch (e) { return null; }
}
// ~55km around a point. Matches LIMIT_KM closely enough that anything inside the box passes the
// distance check that follows.
const boxAround = (lat, lng) => {
  const d = 0.5, dl = 0.5 / Math.max(0.2, Math.cos(rad(lat)));
  return { n: lat + d, s: lat - d, w: lng - dl, e: lng + dl };
};

let exact = 0, approx = 0, skipped = 0;
for (const s of suspects) {
  if (s.p.spread > AMBIG_KM) {
    skipped++;
    console.log(`  !  ${s.e[0]} — "${s.town}, ${s.country}" is ambiguous (${s.p.spread.toFixed(0)}km apart), skipped`);
    continue;
  }
  const venue = unent(s.m.venue || s.e[0]);
  const cq = s.country === 'Northern-Ireland' ? 'Northern Ireland' : s.country;
  const box = boxAround(s.p.best.lat, s.p.best.lng);
  let hit = await geocode([venue, s.town, cq].join(', '));
  if (hitNetwork) await sleep(1100);
  let good = hit && hav(s.p.best.lat, s.p.best.lng, hit.lat, hit.lng) <= ACCEPT_KM;
  if (!good) {
    // Second chance, confined to the town. Many of these grounds carry names shared by hundreds of
    // others ("Stade Municipal", "Centro Sportivo Comunale") and are findable only this way.
    hit = await geocode(venue, box);
    if (hitNetwork) await sleep(1100);
    good = hit && hav(s.p.best.lat, s.p.best.lng, hit.lat, hit.lng) <= ACCEPT_KM;
  }
  const pt = good ? hit : { lat: s.p.best.lat, lng: s.p.best.lng };
  console.log(`  ${good ? '→' : '~'}  ${s.e[0]} (${s.town}, ${s.country})${good ? '' : '  [town centre]'}`);
  console.log(`       was ${s.e[1].toFixed(4)},${s.e[2].toFixed(4)}  (${s.km.toFixed(0)}km from town)`);
  console.log(`       now ${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`);
  s.e[1] = pt.lat; s.e[2] = pt.lng;
  if (good) exact++; else approx++;
}

console.log(`\nexact=${exact} town-centre=${approx} skipped-ambiguous=${skipped}`);
fs.writeFileSync(GC_PATH, JSON.stringify(gcache));
if ((exact + approx) && WRITE) { fs.writeFileSync(WORLD_PATH, JSON.stringify(world)); console.log('wrote ' + WORLD_PATH); }
else if (exact + approx) console.log('DRY RUN — re-run with WRITE=1 to save');
