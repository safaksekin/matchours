// Add the 2026 World Cup grounds to public/stadiums-world.json.
//
// Run:  node scripts/add-worldcup-venues.mjs        (dry run)
//       WRITE=1 node scripts/add-worldcup-venues.mjs
//
// WHY these and not "more grounds generally". gen-venues-geo.mjs builds from /teams?country=X across
// 51 European countries, which is the right scope for a league ground set — but the tournament this
// summer was played in the United States, Canada and Mexico, and the app's users logged it. On the
// live database three of the attended venues that will not resolve are AT&T Stadium, Mercedes-Benz
// Stadium and Estadio Banorte: real matches, really attended, and the passport could count them but
// never pin them because no club in the set plays there.
//
// Sixteen rows, geocoded rather than typed from memory, and skipped if the ground is already in the
// file (Hard Rock Stadium already is). Written in the same shape as everything else, with the city
// and country filled in so they feed the passport's city and country totals:
// [name, lat, lng, cap, teamId, covered, city, country]. teamId 0 and covered 0 — no club plays
// here week to week, so the fixture lookup and the nearby feed must keep ignoring them.

import fs from 'node:fs';

const WORLD_PATH = 'public/stadiums-world.json';
const WRITE = process.env.WRITE === '1';
const UA = 'stadory-venue-fix/1.0 (safaksekin@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toString().replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Name as API-Football writes it (that is what a log carries), then the town to disambiguate the
// query, the country, and the tournament capacity.
const VENUES = [
  ['MetLife Stadium', 'East Rutherford', 'USA', 82500],
  ['AT&T Stadium', 'Arlington', 'USA', 80000],
  ['Mercedes-Benz Stadium', 'Atlanta', 'USA', 71000],
  ['NRG Stadium', 'Houston', 'USA', 72220],
  ['Lincoln Financial Field', 'Philadelphia', 'USA', 69796],
  ['Levi’s Stadium', 'Santa Clara', 'USA', 68500],
  ['Lumen Field', 'Seattle', 'USA', 69000],
  ['SoFi Stadium', 'Inglewood', 'USA', 70240],
  ['Gillette Stadium', 'Foxborough', 'USA', 65878],
  ['Arrowhead Stadium', 'Kansas City', 'USA', 76416],
  ['Hard Rock Stadium', 'Miami Gardens', 'USA', 64767],
  ['BMO Field', 'Toronto', 'Canada', 45736],
  ['BC Place', 'Vancouver', 'Canada', 54500],
  ['Estadio Banorte', 'Mexico City', 'Mexico', 87523],
  ['Estadio Akron', 'Guadalajara', 'Mexico', 48071],
  ['Estadio BBVA', 'Monterrey', 'Mexico', 53500],
];

const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));
const have = new Map(world.map((e) => [norm(e[0]), e]));

async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
}

let added = 0, skipped = 0, failed = 0, placed = 0;
for (const [name, city, country, cap] of VENUES) {
  const existing = have.get(norm(name));
  if (existing) {
    // Present, but the earlier generator left it place-less — it has no club, so gen-venue-places
    // had nothing to join on. Fill the town in: without it the ground pins but adds nothing to the
    // passport's city and country totals, which is half of what a World Cup ground is for.
    while (existing.length < 6) existing.push(0);
    if (!existing[6]) { existing[6] = city; existing[7] = country; placed++; console.log(`  ~  ${name} — already in the set, town filled in (${city})`); }
    else console.log(`  =  ${name} — already in the set`);
    skipped++;
    continue;
  }
  const hit = await geocode(`${name}, ${city}, ${country}`) || await geocode(`${name}, ${country}`);
  await sleep(1100);
  if (!hit) { failed++; console.log(`  ?  ${name} — not found`); continue; }
  world.push([name, +hit.lat.toFixed(4), +hit.lng.toFixed(4), cap, 0, 0, city, country]);
  added++;
  console.log(`  +  ${name}  ${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}  (${city}, ${country})`);
}

console.log(`\nadded=${added} already-there=${skipped} (of which ${placed} gained a town) not-found=${failed}  → ${world.length} grounds`);
if ((added || placed) && WRITE) { fs.writeFileSync(WORLD_PATH, JSON.stringify(world)); console.log('wrote ' + WORLD_PATH); }
else if (added || placed) console.log('DRY RUN — re-run with WRITE=1 to save');
