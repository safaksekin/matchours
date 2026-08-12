// Rebuild public/stadiums-world.json from EVERY API-Football club of Europe (UK nations + Turkey
// included), geocoded via Nominatim (API venues carry address+city but NO coordinates).
//
// Run:  node --env-file-if-exists=.env.seed scripts/gen-venues-geo.mjs
//
// Entry format v2: [name, lat, lng, capacity, teamId] — teamId is the API-Football id of the club
// that plays there, and it is what the app's popups/nearby feed use to resolve the ground's next
// match (fixtures?team=ID&next=N — the venue+next combination returns nothing upstream, so a
// ground without a teamId can never show a fixture). Existing v1 4-tuples are retrofitted with a
// teamId when a club's venue matches them by name or sits within ~250m.
//
// - Source: /teams?country=X (paged) — one row per club WITH its venue, so the set is exactly
//   "every team the API returns", League Two and National League included, not just big grounds.
// - Resumable: every geocode result (hits AND misses) lands in scripts/venues-geo-cache.json,
//   and world.json is rewritten after EVERY country, so a rerun only queries what it hasn't
//   answered yet and a killed run keeps everything it finished.
// - Polite: 1.1s between Nominatim calls (their usage policy), custom User-Agent.
// - Careful: results are country-locked (countrycodes) and a venue is SKIPPED when no confident
//   hit exists — a missing pin is better than a pin in the wrong town.
// - Rate-limit-safe: an api-sports "requests per minute" error sleeps 61s and retries instead of
//   losing the country.

import fs from 'node:fs';

const KEY = process.env.APISPORTS_KEY;
if (!KEY) { console.error('APISPORTS_KEY missing (run with --env-file-if-exists=.env.seed)'); process.exit(1); }

// Europe by ISO-3166 alpha-2 — the UK nations are separate API-Football "countries" and are matched
// by NAME below (their `code` field is not a reliable ISO code). Russia deliberately absent.
const EURO_CC = new Set([
  'AL','AD','AT','AZ','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','GE','DE','GI','GR',
  'HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO',
  'SM','RS','SK','SI','ES','SE','CH','TR','UA',
]);
const UK_NAMES = { england: 'gb', scotland: 'gb', wales: 'gb', 'northern-ireland': 'gb', 'northern ireland': 'gb' };
// The user-facing priority: England (the reported gap) first, then Turkey, then the big-league
// countries — so the most-wanted grounds land in world.json within the first hours of a long run.
const FIRST = ['England', 'Turkey', 'Scotland', 'Wales', 'Northern-Ireland', 'Spain', 'Italy', 'Germany', 'France', 'Netherlands', 'Portugal', 'Belgium'];

const WORLD_PATH = 'public/stadiums-world.json';
const CACHE_PATH = 'scripts/venues-geo-cache.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
const retriedNulls = new Set(); // cached misses re-attempted this run (once each)

// api-sports GET with per-minute-limit patience: their error payload is a 200 with `errors`, so
// status alone is not enough. Anything transient sleeps and retries; a hard error returns null.
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
    console.log('  api retry (' + msg.slice(0, 80) + ') — waiting ' + Math.round(wait / 1000) + 's');
    await sleep(wait);
  }
  return null;
}

// Every club of a country, across pages. Row: { team: {id,name}, venue: {id,name,city,capacity} }.
async function apiTeams(country) {
  const rows = [];
  let page = 1, total = 1;
  do {
    const j = await apiGet('/teams?country=' + encodeURIComponent(country) + (page > 1 ? '&page=' + page : ''));
    if (!j) break;
    rows.push(...(j.response || []));
    total = (j.paging && j.paging.total) || 1;
    page++;
    await sleep(300); // stay under the per-second cap
  } while (page <= total);
  return rows;
}

async function nominatim(q, cc) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=' + cc + '&q=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { 'User-Agent': 'stadory-venue-geocoder/1.0 (dev script)' } });
  if (!res.ok) return null;
  const j = await res.json();
  const hit = j && j[0];
  if (!hit) return null;
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
}

function kmBetween(a, b, c, d) {
  const p = Math.PI / 180;
  const x = 0.5 - Math.cos((c - a) * p) / 2 + Math.cos(a * p) * Math.cos(c * p) * (1 - Math.cos((d - b) * p)) / 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));
const byName = new Map(); // lower name -> entry (first wins; big grounds sorted first)
world.forEach((e) => { const k = String(e[0]).toLowerCase(); if (!byName.has(k)) byName.set(k, e); });
const saveWorld = () => {
  world.sort((a, b) => (b[3] || 0) - (a[3] || 0));
  fs.writeFileSync(WORLD_PATH, JSON.stringify(world));
};

// which countries — /countries filtered to Europe (code) + UK nations (name)
const cj = await apiGet('/countries');
if (!cj) { console.error('cannot list countries'); process.exit(1); }
const all = (cj.response || [])
  .map((c) => ({ name: c.name, cc: UK_NAMES[String(c.name).toLowerCase()] || (EURO_CC.has(c.code) ? String(c.code).toLowerCase() : null) }))
  .filter((c) => c.cc);
all.sort((a, b) => {
  const ia = FIRST.indexOf(a.name), ib = FIRST.indexOf(b.name);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
});
// Optional narrowing for follow-up passes:  ONLY="England,Turkey" limits the sweep to those
// countries, and RETRY_MISSES=1 re-asks stamped misses regardless of their 3-day cool-off —
// used to heal stretches where a long run tripped Nominatim's soft limits and a whole block of
// real grounds (Broadfield, Holker Street…) got stamped as misses.
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const filtered = ONLY.length ? all.filter((c) => ONLY.includes(c.name.toLowerCase())) : all;
console.log('countries (' + filtered.length + '): ' + filtered.map((c) => c.name).join(', '));

let added = 0, linked = 0, skipped = 0, misses = 0, done = 0;
for (const C of filtered) {
  const rows = await apiTeams(C.name);
  console.log(C.name + ': ' + rows.length + ' clubs');
  for (const r of rows) {
    done++;
    const teamId = r.team && r.team.id;
    const v = r.venue || {};
    const name = (v.name || '').trim();
    if (!teamId || !name || !v.id) continue;

    // an entry already carrying this ground by name? just retrofit the teamId (v1 4-tuples)
    const known = byName.get(name.toLowerCase());
    if (known) { if (known[4] == null) { known[4] = teamId; linked++; } else skipped++; continue; }

    const key = 'v' + v.id;
    // A cached miss is retried, but not on every restart: the original run cached a null for any
    // transient failure too (Nominatim 429s / network), which is how HALF of England's grounds
    // (Broadfield, Holker Street, Wetherby Road…) became permanent misses that all resolve fine
    // when asked again. A retried-and-still-missing venue is stamped {m: <ms>} and left alone for
    // 3 days — resumed runs used to burn ~half an hour re-asking England's true misses before
    // reaching any new country. Legacy nulls (no stamp) always qualify for one retry.
    const c = cache[key];
    const staleMiss = c === null || (c && c.m && (process.env.RETRY_MISSES === '1' || Date.now() - c.m > 3 * 86400000));
    if (!(key in cache) || (staleMiss && !retriedNulls.has(key))) {
      retriedNulls.add(key);
      const city = (v.city || '').trim();
      const addr = (v.address || '').trim();
      let hit = null;
      try {
        if (city) { hit = await nominatim(name + ', ' + city, C.cc); await sleep(1100); }
        if (!hit) { hit = await nominatim(name, C.cc); await sleep(1100); }
        // last resort: the venue's street + city — town-accurate even when the ground itself isn't
        // in OSM under this (often sponsor-renamed) name; the street is adjacent to the ground.
        if (!hit && addr && city) { hit = await nominatim(addr + ', ' + city, C.cc); await sleep(1100); }
      } catch (e) { /* network blip → treated as miss, rerun resumes it */ }
      cache[key] = hit ? { lat: hit.lat, lng: hit.lng, name, cap: v.capacity || 0 } : { m: Date.now() };
      saveCache();
      if (done % 25 === 0) console.log('  … ' + done + ' processed (' + added + ' added, ' + linked + ' linked so far)');
    }
    const g = cache[key];
    if (!g || g.lat == null) { misses++; continue; } // null OR a {m:…} miss-stamp
    // same ground under a sponsor-renamed entry? retrofit that one instead of a duplicate pin
    const nearDupe = world.find((e) => kmBetween(e[1], e[2], g.lat, g.lng) < 0.25);
    if (nearDupe) { if (nearDupe[4] == null) { nearDupe[4] = teamId; linked++; } else skipped++; continue; }
    const entry = [name, Math.round(g.lat * 1e4) / 1e4, Math.round(g.lng * 1e4) / 1e4, g.cap || 0, teamId];
    world.push(entry);
    byName.set(name.toLowerCase(), entry);
    added++;
  }
  saveWorld(); // a killed run keeps every finished country
  console.log('  ' + C.name + ' done — total now ' + world.length + ' (added ' + added + ', linked ' + linked + ')');
}

saveWorld();
console.log('DONE. added=' + added + ' teamId-linked=' + linked + ' dupes-skipped=' + skipped + ' geocode-miss=' + misses + ' total-now=' + world.length);
