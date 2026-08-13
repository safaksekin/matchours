// Build public/destinations.json — every TOWN that has a club, for Trip's "where are you going?"
// field.
//
// Run:  GEONAMES=/path/to/cities500.txt node --env-file-if-exists=.env.seed scripts/gen-destinations.mjs
//
// WHY. fikstur-app/lib/cities.js holds a hand-written list of 126 destinations, and that was the
// right call when it was written: the fixture feed gives a venue city as a bare string, so a
// searchable destination set had to come from somewhere, and typing out the cities of 45 curated
// grounds is an afternoon's work. It does not survive the ground set growing to 9,242 across every
// division. Karlsruhe has a 2. Bundesliga club and is not in it. Neither is Salford, Freiburg,
// Muğla, or several hundred other towns with a professional or semi-professional side. A planner
// that answers "no such place" for Karlsruher SC's home town is broken in the same way the map was
// when it only had major grounds.
//
// The list can be DERIVED now, which it could not be then. venues-country-cache.json (built by
// audit-venue-coords.mjs) maps every club to the town and country the API files it under, and a
// GeoNames gazetteer turns a town name into coordinates. A destination is then simply "a town at
// least one club plays in" — which is exactly the set a football trip planner should offer, and it
// stays in step with the ground data instead of drifting behind it.
//
// The hand-written list is NOT replaced. It stays in the app as the offline core and the popular
// defaults, with better local spellings (Türkiye, München) than anything derivable; this file is
// merged on top when it loads, the same way stadiums-world.json layers over STADIUMS.
//
// Output rows: [name, country, lat, lng, sameName[], exonym[], flag, clubs, pop].
//
// The two name lists are kept APART on purpose. `sameName` is this place under another orthography
// — the API's spelling, the accentless form — and it identifies the place: if one of those matches a
// curated city, they are the same city. `exonym` is what OTHER LANGUAGES call it (Münih, Mailand),
// which is worth searching but must never decide identity. Merged into one list they did: a
// gazetteer's alternate names run to ninety-odd per city and quietly collide across places, so
// Bursa adopted a neighbour's rows and Cardiff appeared twice. Search on both, identify on the first.
//
// `pop` ranks the search, so a city always outranks the village that shares three letters with it.
// Compact array-of-arrays, like the ground file.
//
// DISPLAY NAMES ARE THE GAZETTEER'S PRIMARY FORM, which for the well-known places is the
// international one — Munich, not München; Vienna, not Wien. That is the right default HERE and the
// wrong one for a famous city, which is exactly why the curated list keeps its 126 entries and wins
// every overlap: a user going to Munich sees München because lib/cities.js says so, and a user going
// to Karlsruhe sees Karlsruhe because there is only one spelling of it. Local spellings for the
// places people have opinions about, a consistent typeable form for the long tail.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }
const GEO = process.env.GEONAMES;
if (!GEO || !fs.existsSync(GEO)) { console.error('GEONAMES=<path to cities500.txt> required'); process.exit(1); }

const OUT = 'public/destinations.json';
const CC_PATH = 'scripts/venues-country-cache.json';
const AMBIG_KM = 40; // same rule as the coordinate fixer: a name shared by two distant places is unusable
// Only cities this size get their foreign-language spellings indexed. Below it, nobody has invented
// a different word for the place — Karlsruhe is Karlsruhe in every language — so the alternates are
// noise and weight.
const BIG_CITY_POP = 100000;

const R = 6371, rad = (d) => d * Math.PI / 180;
const hav = (a, b, c, d) => {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const unent = (s) => (s || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// Must fold exactly as lib/cities.js normCity does, or a generated key will never match a typed one.
const norm = (s) => unent(s).replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const cj = await (await fetch('https://v3.football.api-sports.io/countries', { headers: { 'x-apisports-key': KEY } })).json();
const codeOf = {};
for (const c of cj.response || []) if (c.code) codeOf[c.name] = c.code;
for (const n of ['England', 'Scotland', 'Wales', 'Northern-Ireland']) codeOf[n] = 'GB';

// The app shows countries in their own spelling. Where lib/cities.js already has a name for one,
// use it, so a generated Karlsruhe sits under the same "Deutschland" heading as a hand-written
// München instead of opening a second, English-named country next to it.
const COUNTRY_NAME = {
  Turkey: 'Türkiye', Germany: 'Deutschland', Spain: 'España', Italy: 'Italia', Netherlands: 'Nederland',
  Belgium: 'België', Switzerland: 'Schweiz', Austria: 'Österreich', Poland: 'Polska', Wales: 'Cymru',
  Ireland: 'Éire', 'Czech-Republic': 'Česko', Hungary: 'Magyarország', Croatia: 'Hrvatska',
  Serbia: 'Srbija', Romania: 'România', Bulgaria: 'България', Denmark: 'Danmark', Sweden: 'Sverige',
  Norway: 'Norge', Finland: 'Suomi', Greece: 'Ελλάδα', Portugal: 'Portugal', France: 'France',
  'Northern-Ireland': 'Northern Ireland', 'San-Marino': 'San Marino',
};
// England, Scotland and Wales all sit under GB, so a flag cannot come from the country code alone.
const FLAG_OVERRIDE = {
  England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'Northern-Ireland': '🇬🇧',
};
const flagOf = (country) => FLAG_OVERRIDE[country] ||
  (codeOf[country] && codeOf[country].length === 2
    ? String.fromCodePoint(...[...codeOf[country].toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
    : '');

// name+country → most populous place of that name, plus how far its namesakes sit from it.
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
    if (!p.best || p.best.pop < pop) p.best = { lat, lng, pop, name: f[1], ascii: f[2], alt: f[3] || '' };
  }
}
for (const p of Object.values(places)) p.spread = Math.max(...p.pts.map((q) => hav(p.best.lat, p.best.lng, q.lat, q.lng)));

const meta = JSON.parse(fs.readFileSync(CC_PATH, 'utf8')).meta || {};

// Count clubs per town first: a town with more clubs is a better destination and, more usefully,
// the count is what orders the file so the app can cut it off if it ever needs to.
const towns = {};
for (const m of Object.values(meta)) {
  if (!m.city || !m.country) continue;
  const town = unent(m.city).split(',')[0].trim();
  if (!town) continue;
  const k = m.country + '|' + norm(town);
  (towns[k] = towns[k] || { town, country: m.country, n: 0 })
    .n++;
}

const out = [];
let noPlace = 0, ambiguous = 0;
for (const t of Object.values(towns)) {
  const cc = codeOf[t.country];
  const p = cc && places[cc + '|' + norm(t.town)];
  if (!p) { noPlace++; continue; }
  // A town whose name belongs to two distant places cannot be offered as one destination: picking
  // either would silently answer a different question than the user asked.
  if (p.spread > AMBIG_KM) { ambiguous++; continue; }
  // Every spelling worth answering to: what the API writes, what the place calls itself, the ASCII
  // form, and — for cities big enough that other languages have their own word for them — a slice of
  // the gazetteer's alternate names, so a Turkish user typing "Münih" finds Munich and a German
  // typing "Mailand" finds Milano. Capped hard: Munich alone carries 94 alternates, and all of them
  // for all 5,593 destinations would be a multi-megabyte download to answer a question about spelling.
  const names = [t.town, p.best.name, p.best.ascii].filter(Boolean).map((x) => unent(x));
  const name = p.best.name || t.town;
  const sameName = [...new Set(names)].filter((a) => a !== name);
  const exonym = [];
  if (p.best.pop >= BIG_CITY_POP) {
    const seen = new Set(names.map(norm));
    for (const a of p.best.alt.split(',')) {
      if (exonym.length >= 30) break;
      const trimmed = a.trim();
      // Airport codes and postal abbreviations are in there too ("MUC"); they match nothing a person
      // would type as a destination and would only add noise to a prefix search. Multi-word entries
      // go the same way: they are descriptions rather than names ("Lungsod ng Muenchen"), and while
      // they sat in the list they crowded out the ones people actually type — the cap filled with
      // Filipino noun phrases before it reached Münih.
      //
      // The cap is 30 because that is where the useful spellings run out, not a round number: Munich
      // carries 81 usable alternates and the Turkish "Münih" is the 41st. It is reachable anyway —
      // "Munih" is the 25th, and normCity folds both to the same key — which is the general case, so
      // the accented forms cost nothing to skip.
      if (trimmed.length < 4 || trimmed.length > 24 || /\s/.test(trimmed) || seen.has(norm(trimmed))) continue;
      seen.add(norm(trimmed));
      exonym.push(trimmed);
    }
  }
  out.push([name, COUNTRY_NAME[t.country] || t.country, +p.best.lat.toFixed(4), +p.best.lng.toFixed(4),
            sameName, exonym, flagOf(t.country), t.n, p.best.pop]);
}
// Population first: the file's order is the tie-break the app searches on, and "where are you
// going?" is nearly always answered with a city. A town with a club stays in the list — it is a real
// place to see a real match — it just does not come before Berlin when three letters match both.
out.sort((a, b) => b[8] - a[8] || b[7] - a[7] || a[0].localeCompare(b[0]));

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`towns with a club: ${Object.keys(towns).length}`);
console.log(`written: ${out.length}  (not in gazetteer: ${noPlace}, ambiguous name: ${ambiguous})`);
console.log(`${OUT} — ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
