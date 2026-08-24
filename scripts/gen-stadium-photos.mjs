// Build public/stadium-photos.json — a licensed Wikimedia Commons photo (with its credit) for every
// ground we can match, keyed the way the app looks grounds up:
//   { "<normKey(name)>": [thumbUrl, artist, licence, commonsPageUrl], ... }
//
// Run:  node scripts/gen-stadium-photos.mjs            (~5–10 min cold; resumable via the cache)
//       node scripts/gen-stadium-photos.mjs --refresh  (ignore the cache, refetch everything)
//
// WHY. The app no longer ships any stadium photo (the old assets/stadiums/ pool was pulled off
// Google with no licence) and API-Sports only has pictures for the bigger grounds. Wikimedia Commons
// has a photo for about half of the world's stadiums (Wikidata: 7.7k of 15k carry P18), under
// licences that allow us to show them as long as the author and licence are credited — and the
// stadium page has a credit line for exactly that. This script does the matching OFFLINE, once, so
// the app never searches Wikidata by name at runtime: a name search returned "Motspur Park" the
// railway station, and Wikidata rate-limits anonymous clients within seconds.
//
// HOW. Every Wikidata SPORTS VENUE (Q1076486 and its subclasses — "stadium" alone misses San Siro,
// filed as a multi-purpose stadium) with an image AND coordinates is pulled in one SPARQL query,
// then matched to our grounds (public/stadiums-world.json + the app's 49 curated grounds) by
// DISTANCE, with the name as the tie-break: a ground's coordinates are the one fact both sides
// agree on, where names differ by sponsor, language and spelling. Matched files get their licence
// and author from the Commons API (`imageinfo` + `extmetadata`, the Media Viewer's own source), and
// only CC0 / public-domain / CC BY / CC BY-SA files are kept — no NC, no ND, no GFDL-only.
//
// Idempotent. Everything fetched is cached in scripts/stadium-photos-cache.json, so a rerun after a
// world-file rebuild only fetches what is new.

import fs from 'node:fs';

const WORLD_PATH = 'public/stadiums-world.json';
const CURATED_PATH = '../fikstur-app/lib/stadiums.js';
const OUT_PATH = 'public/stadium-photos.json';
const CACHE_PATH = 'scripts/stadium-photos-cache.json';
const UA = 'stadory-gen-stadium-photos/1.0 (https://stadory.com; build script)';
const REFRESH = process.argv.includes('--refresh');

const MAX_KM = 1.5;       // a ground and its Wikidata item must be this close (world coords are ~2-4 dp)
const SURE_KM = 0.35;     // this close, the name barely matters
const MIN_SIM = 0.34;     // beyond SURE_KM the names must agree at least this much
const THUMB_W = 1600;     // the app's widest use is a full-width hero on a 3x screen

// ── caches ────────────────────────────────────────────────────────────────
const cache = !REFRESH && fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
cache.commons = cache.commons || {};   // "File:X.jpg" -> extmetadata summary | null (no usable licence)
const saveCache = () => fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.slice(0, 120));
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

// ── the app's key (lib: normCityKey in App.js — keep byte-for-byte in step) ──
const normKey = (s) => (s || '').toString().replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Name similarity: token Jaccard after dropping the words every ground shares ("stadium" in nine
// languages, "arena", "park"…) — "Türk Telekom Stadyumu" vs "Rams Park" is 0, "Anfield" vs
// "Anfield Stadium" is 1.
const GENERIC = new Set(('stadium stadion stadio stade estadio estadi stadyumu stadyum stadi stad stadionul stadien stadions ' +
  'arena park sportpark sports sport spor ground grounds field complex kompleksi kompleks futbol football fc club cf sc sk ' +
  'the of de del della do da di le la el les los las ve and und municipal belediye sehir city new yeni').split(' '));
const tokens = (s) => new Set(normKey(s).split(' ').filter((w) => w && !GENERIC.has(w)));
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size && !B.size) return 0.5; // both were only generic words ("Stadyum" vs "Stadium")
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  // a token contained in another ("gursel" vs "gurselaksel") still counts for half
  if (!inter) for (const w of A) for (const v of B) if (w.length >= 4 && v.length >= 4 && (w.includes(v) || v.includes(w))) inter += 0.5;
  return inter / (A.size + B.size - inter);
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── 1. our grounds ─────────────────────────────────────────────────────────
const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8'));
const grounds = world.map((r) => ({ name: r[0], lat: r[1], lng: r[2], country: r[7] || '', names: [r[0]] }));
if (fs.existsSync(CURATED_PATH)) {
  const src = fs.readFileSync(CURATED_PATH, 'utf8');
  // the curated entries carry ALIASES (sponsor names, the old name, the club) — extra names to
  // match Wikidata's labels against, which is what tells "Ülker Stadyumu" and "Şükrü Saracoğlu" apart
  const re = /name:\s*"([^"]+)"[^\n]*?lat:\s*(-?\d+(?:\.\d+)?),\s*lng:\s*(-?\d+(?:\.\d+)?)[^\n]*?(?:aliases:\s*\[([^\]]*)\])?/g;
  let m, n = 0;
  const byKey = new Map(grounds.map((g) => [normKey(g.name), g]));
  while ((m = re.exec(src))) {
    const aliases = (m[4] || '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const g = byKey.get(normKey(m[1]));
    if (g) { g.names.push(...aliases); continue; }
    grounds.push({ name: m[1], lat: +m[2], lng: +m[3], country: '(curated)', names: [m[1], ...aliases] }); n++;
  }
  console.log(`grounds: ${world.length} world + ${n} curated-only`);
} else console.log(`grounds: ${world.length} world (curated file not found at ${CURATED_PATH})`);

// ── 2. Wikidata: every sports venue with an image and coordinates ──────────
// One query, no labels (labels ×20 languages is what times the endpoint out); labels come next in
// batches. `p:P625/psv:P625` reads the coordinate's components without a string parse. ALL of an
// item's images are kept, in statement order: the first is not always usable (Old Trafford's is a
// 415px scan), and the second often is.
async function fetchWikidata() {
  if (cache.wd && cache.wd.length && cache.wdRoot === 'Q1076486') return cache.wd;
  const q = `SELECT ?s ?lat ?lon ?img WHERE {
    ?s wdt:P31/wdt:P279* wd:Q1076486 ; wdt:P18 ?img ; p:P625/psv:P625 ?c .
    ?c wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon .
  }`;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q);
  console.log('wikidata: fetching stadium items…');
  const j = await getJSON(url);
  const seen = new Map();
  for (const b of j.results.bindings) {
    const id = b.s.value.split('/').pop();
    const file = decodeURIComponent(b.img.value.split('/Special:FilePath/')[1] || '').replace(/_/g, ' ');
    const it = seen.get(id) || seen.set(id, { id, lat: +b.lat.value, lng: +b.lon.value, files: [], labels: [] }).get(id);
    if (file && !it.files.includes(file)) it.files.push(file);
  }
  cache.wd = [...seen.values()];
  cache.wdRoot = 'Q1076486';
  saveCache();
  console.log(`wikidata: ${cache.wd.length} sports venues with a photo + coordinates`);
  return cache.wd;
}
// Labels + aliases in the languages our grounds are named in, 50 items per call (the API's cap).
async function fetchLabels(items) {
  const need = items.filter((it) => !it.labels || !it.labels.length);
  console.log(`wikidata: labels for ${need.length} items…`);
  const LANGS = 'en|tr|de|es|it|fr|pt|nl|pl|el|ro|hu|cs|sv|da|no|fi|hr|sr|bg|uk|ru';
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels|aliases&languages=' + LANGS +
      '&format=json&ids=' + chunk.map((it) => it.id).join('|');
    const j = await getJSON(url);
    for (const it of chunk) {
      const e = j && j.entities && j.entities[it.id];
      const out = new Set();
      if (e) {
        for (const l of Object.values(e.labels || {})) out.add(l.value);
        for (const arr of Object.values(e.aliases || {})) for (const a of arr) out.add(a.value);
      }
      it.labels = [...out];
      if (!it.labels.length) it.labels = ['?'];
    }
    if ((i / 50) % 20 === 0) { saveCache(); process.stdout.write(`  ${Math.min(i + 50, need.length)}/${need.length}\r`); }
    await sleep(250);
  }
  saveCache();
  console.log('');
}

// ── 3. match grounds → items by distance, names as tie-break ───────────────
function matchAll(grounds, items) {
  const cell = (lat, lng) => Math.floor(lat / 0.02) + ':' + Math.floor(lng / 0.02);
  const grid = new Map();
  for (const it of items) { const k = cell(it.lat, it.lng); (grid.get(k) || grid.set(k, []).get(k)).push(it); }
  const out = new Map(); // normKey(ground) -> { ground, item, km, sim }
  let ambiguous = 0;
  for (const g of grounds) {
    if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) continue;
    const cands = [];
    const clat = Math.floor(g.lat / 0.02), clng = Math.floor(g.lng / 0.02);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const it of grid.get((clat + dy) + ':' + (clng + dx)) || []) {
        const km = haversineKm(g.lat, g.lng, it.lat, it.lng);
        if (km > MAX_KM) continue;
        let sim = 0;
        for (const l of it.labels) for (const nm of g.names || [g.name]) sim = Math.max(sim, similarity(nm, l));
        cands.push({ it, km, sim, labels: it.labels.length });
      }
    }
    if (!cands.length) continue;
    // score: names first (a sponsor rename still shares a token more often than not), then how
    // well-described the item is (a ground in use has labels in many languages; the demolished
    // predecessor at the same coordinates — Papazın Çayırı under Şükrü Saracoğlu — has two), then distance
    cands.sort((a, b) => (b.sim - a.sim) || (b.labels - a.labels) || (a.km - b.km));
    const best = cands[0], second = cands[1];
    const ok = best.sim >= MIN_SIM || (best.km <= SURE_KM && (
      !second || best.sim >= second.sim + 0.15 || second.km > SURE_KM || best.labels >= 2 * second.labels));
    if (!ok) { ambiguous++; continue; }
    const key = normKey(g.name);
    if (!out.has(key)) out.set(key, { ground: g, item: best.it, km: best.km, sim: best.sim });
  }
  console.log(`match: ${out.size} grounds matched, ${ambiguous} left unmatched as ambiguous/too far`);
  return out;
}

// ── 4. Commons: licence + author + a 1600px thumb, 50 files per call ───────
const LICENCE_OK = /^(cc0|public domain|pd|no restrictions|cc by \d|cc by-sa \d|cc-by \d|cc-by-sa \d)/i;
const LICENCE_BAD = /\b(nc|nd)\b|gfdl only|fair use|non-?commercial/i;
const stripHtml = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\(talk\)|\(.*?diskussion.*?\)/gi, '').trim();
async function fetchCommons(files) {
  const need = files.filter((f) => !(f in cache.commons));
  console.log(`commons: metadata for ${need.length} files (${files.length - need.length} cached)…`);
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=' + THUMB_W +
      '&format=json&formatversion=2&titles=' + encodeURIComponent(chunk.map((f) => 'File:' + f).join('|'));
    const j = await getJSON(url);
    const pages = (j && j.query && j.query.pages) || [];
    const byTitle = new Map();
    for (const p of pages) byTitle.set(p.title, p);
    // the API normalises titles (underscores, first-letter case); map back through `normalized`
    const norm = new Map();
    for (const n of (j && j.query && j.query.normalized) || []) norm.set(n.from, n.to);
    for (const f of chunk) {
      const t = 'File:' + f;
      const p = byTitle.get(norm.get(t) || t);
      const ii = p && p.imageinfo && p.imageinfo[0];
      const em = (ii && ii.extmetadata) || {};
      const licence = stripHtml(em.LicenseShortName && em.LicenseShortName.value);
      const mime = (ii && ii.mime) || '';
      const usable = ii && ii.thumburl && /^image\/(jpeg|png|webp)$/.test(mime) && (ii.width || 0) >= 600 &&
        licence && LICENCE_OK.test(licence) && !LICENCE_BAD.test(licence);
      cache.commons[f] = usable ? {
        u: ii.thumburl.split('?')[0], // Commons appends utm_* tracking to API thumb URLs — not part of the file
        a: stripHtml(em.Artist && em.Artist.value).slice(0, 60),
        l: licence,
        p: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(t)),
      } : null;
    }
    if ((i / 50) % 10 === 0) { saveCache(); process.stdout.write(`  ${Math.min(i + 50, need.length)}/${need.length}\r`); }
    await sleep(300);
  }
  saveCache();
  console.log('');
}

// Curated coordinate audit: a curated ground with NO venue nearby but a same-named one further off
// is our coordinate that is wrong (Konya's sat 5 km from the ground), and the map pin with it.
function auditCurated(grounds, items, matched) {
  for (const g of grounds) {
    if (g.country !== '(curated)' || matched.has(normKey(g.name))) continue;
    let best = null;
    for (const it of items) {
      const km = haversineKm(g.lat, g.lng, it.lat, it.lng);
      if (km > 25) continue;
      let sim = 0;
      for (const l of it.labels) for (const nm of g.names) sim = Math.max(sim, similarity(nm, l));
      if (sim >= 0.5 && (!best || sim > best.sim || (sim === best.sim && km < best.km))) best = { it, km, sim };
    }
    if (best) console.log(`  ⚠ curated coords suspect: "${g.name}" — ${best.it.id} (${best.it.labels[0]}) is ${best.km.toFixed(1)} km from our pin`);
  }
}

// ── run ────────────────────────────────────────────────────────────────────
const items = await fetchWikidata();
await fetchLabels(items);
const matched = matchAll(grounds, items);
// an item's first image, then its second… until one is usable (or none is)
for (let round = 0; round < 3; round++) {
  const want = [];
  for (const m of matched.values()) {
    const files = m.item.files || [m.item.file];
    if (files.slice(0, round).some((f) => cache.commons[f])) continue; // already have one
    if (files[round]) want.push(files[round]);
  }
  if (!want.length) break;
  await fetchCommons([...new Set(want)]);
}
auditCurated(grounds, items, matched);

const out = {};
let kept = 0, byCountry = {};
for (const [key, m] of matched) {
  const files = m.item.files || [m.item.file];
  const c = files.map((f) => cache.commons[f]).find(Boolean);
  if (!c) continue;
  out[key] = [c.u, c.a, c.l, c.p];
  kept++;
  const ctry = m.ground.country || '(no country)';
  byCountry[ctry] = (byCountry[ctry] || 0) + 1;
}
fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`\n${OUT_PATH}: ${kept} grounds with a licensed photo (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
console.log('top countries:', Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' ' + v).join(', '));
console.log('Türkiye:', byCountry['Turkey'] || byCountry['Türkiye'] || 0);
