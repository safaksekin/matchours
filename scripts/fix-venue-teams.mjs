// Re-link a few big grounds in public/stadiums-world.json to the CLUB that plays there.
//
// Run:  node scripts/fix-venue-teams.mjs      (idempotent — rerun after any gen-venues-geo.mjs pass)
//
// WHY. gen-venues-geo.mjs lets the first team the API lists claim a ground, and for a handful of
// national stadiums that team is the NATIONAL side (Spain → "Bernabéu", Germany → Westfalenstadion,
// France → Parc OL), so the club arriving later was "dupes-skipped" and the row's teamId never
// pointed at the club. The app resolves a ground's next match by that teamId (fixtures?team&next),
// so Westfalenstadion answered with Germany's fixtures and Real Madrid had no ground at all. Two
// more rows were plain data slips: Hertha's id landed on the demolished "Deutsches Stadion" next
// door to the Olympiastadion, and Benfica's on the 1954 Luz rather than the current one.
//
// The app's MAJOR list (fikstur-app/lib/stadiums.js) keys these rows by id AND name, so it survives
// the file either way — this fix is what makes the next-match lookups right.
import fs from 'node:fs';

const WORLD_PATH = 'public/stadiums-world.json';
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));

// name (exact, as in the file) → the corrections. `rename` replaces the name; other keys replace the
// column of the same meaning. `covered: 1` because every one of these clubs is in a tracked league.
const FIX = {
  'Westfalenstadion':          { teamId: 165, covered: 1 },                  // Borussia Dortmund (was 25 = Germany)
  'Bernabéu':                  { teamId: 541, covered: 1 },                  // Real Madrid (was 9 = Spain)
  'Parc Olympique Lyonnais':   { teamId: 80, covered: 1, city: 'Décines-Charpieu' }, // Lyon (was 2 = France, city copied from the FFF's row)
  'Estádio da Luz':            { teamId: 211, covered: 1, city: 'Lisboa' },  // Benfica (was 27 = Portugal)
  'Estádio da Luz (1954)':     { teamId: 0, covered: 0 },                    // demolished 2003 — must not carry Benfica's id
  'Deutsches Stadion':         { rename: 'Olympiastadion Berlin', teamId: 159, covered: 1, cap: 74475, lat: 52.5147, lng: 13.2395 }, // Hertha BSC's ground is the Olympiastadion; the 1913 Deutsches Stadion stood on the same site
  'Cardiff City Stadium':      { teamId: 43, covered: 1 },                   // Cardiff City (API id 43; was 15642)
};

let changed = 0;
for (const row of world) {
  const fx = FIX[row[0]];
  if (!fx) continue;
  const before = JSON.stringify(row);
  if (fx.rename) row[0] = fx.rename;
  if (fx.lat != null) row[1] = fx.lat;
  if (fx.lng != null) row[2] = fx.lng;
  if (fx.cap != null) row[3] = fx.cap;
  if (fx.teamId != null) row[4] = fx.teamId;
  if (fx.covered != null) row[5] = fx.covered;
  if (fx.city != null) row[6] = fx.city;
  if (JSON.stringify(row) !== before) { changed++; console.log('fixed: ' + before + ' → ' + JSON.stringify(row)); }
}
// the same club id must not sit on two rows (the app's byTeam index takes the first it meets)
const ids = new Map();
for (const row of world) {
  if (!row[4]) continue;
  if (ids.has(row[4]) && Object.values(FIX).some((f) => f.teamId === row[4])) console.warn('WARN duplicate teamId ' + row[4] + ': "' + ids.get(row[4]) + '" and "' + row[0] + '"');
  else ids.set(row[4], row[0]);
}
// GHOSTS. The v1 set (OSM/Wikidata) still carries the demolished predecessor of many big grounds —
// "BJK İnönü Stadium" 40 m from Beşiktaş Stadium, "Papazın Çayırı" on Şükrü Saracoğlu, White Hart
// Lane, Estádio das Antas, Chamartín… — each a second pin on the same terraces, which is the very
// duplication the app's major subset exists to end. A row with NO team id sitting within 500 m of a
// major is such a ghost (a real neighbour — Rote Erde, the Etihad's Academy Stadium — carries its
// club's id and stays). The majors come from the app's own list so the two never drift apart.
const majorsSrc = new URL('../../fikstur-app/lib/stadiums.js', import.meta.url);
let majorRows = null;
try { ({ majorRows } = await import(majorsSrc.href)); } catch (e) { console.warn('majors list not found at ' + majorsSrc.pathname + ' — ghost pass skipped'); }
if (majorRows) {
  const km = (a, b, c, d) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const majors = majorRows(world);
  const ghosts = new Set();
  for (const M of majors) for (const x of world) {
    if (x === M || x[4]) continue;
    if (km(M[1], M[2], x[1], x[2]) < 0.5) { ghosts.add(x); console.log('ghost of ' + M[0] + ': ' + JSON.stringify(x)); }
  }
  if (ghosts.size) { const n = world.length; for (let i = world.length - 1; i >= 0; i--) if (ghosts.has(world[i])) world.splice(i, 1); changed += n - world.length; }
}
if (changed) {
  world.sort((a, b) => (b[3] || 0) - (a[3] || 0));
  fs.writeFileSync(WORLD_PATH, JSON.stringify(world));
}
console.log(changed + ' row(s) changed, total ' + world.length);
