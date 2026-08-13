// Add the town and country to every ground in public/stadiums-world.json, turning rows from
// [name, lat, lng, cap, teamId, covered] into [name, lat, lng, cap, teamId, covered, city, country].
//
// Run:  node scripts/gen-venue-places.mjs        (needs scripts/venues-country-cache.json)
//
// WHY. The passport counts the grounds you have been to, and under them "N cities, N countries" —
// the line that makes a list of stadiums read as a journey. Those two numbers can only come from
// the ground knowing where it is, and until now only the 49 hand-curated stadiums in
// fikstur-app/lib/stadiums.js carried a city and a country. The world set had coordinates and
// nothing else, so a ground outside the curated list could be pinned on the map but could never
// contribute to either counter: attend a match at Kenilworth Road and the passport learned nothing
// about Luton or England from it.
//
// The data already exists locally — venues-country-cache.json maps every club to the town and
// country the API files it under — so this is a join, not a fetch. No API calls, runs instantly.
//
// Rerun after gen-venues-geo.mjs or gen-venue-coverage.mjs, both of which rewrite the file from
// six-element rows. Idempotent: re-running only overwrites the two trailing fields.

import fs from 'node:fs';

const WORLD_PATH = 'public/stadiums-world.json';
const CC_PATH = 'scripts/venues-country-cache.json';

if (!fs.existsSync(CC_PATH)) { console.error('run scripts/audit-venue-coords.mjs first (builds ' + CC_PATH + ')'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(CC_PATH, 'utf8')).meta || {};
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));

// The API writes a county into the city field often enough to matter ("Bristol, Gloucestershire");
// the passport wants the town, and the same first-segment rule is what the audits match on.
const town = (s) => (s || '').replace(/&apos;/g, "'").split(',')[0].trim();

let placed = 0;
for (const e of world) {
  const m = e.length > 4 && e[4] ? meta[e[4]] : null;
  const city = m ? town(m.city) : '';
  const country = m ? m.country : '';
  // Pad first: a row missing its `covered` flag would otherwise take the city into slot 5.
  while (e.length < 6) e.push(0);
  e[6] = city;
  e[7] = country;
  if (city) placed++;
}

fs.writeFileSync(WORLD_PATH, JSON.stringify(world));
console.log(`placed ${placed} of ${world.length} grounds in a town`);
console.log(`${WORLD_PATH} — ${(fs.statSync(WORLD_PATH).size / 1024).toFixed(0)} KB`);
