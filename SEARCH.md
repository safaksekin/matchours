# Search

Universal search (teams · players · matches) for both clients — the web app and
`fikstur-app` — is answered by **our own index**, not by API-Football's `?search=`
parameter.

## Why we stopped proxying search upstream

Search used to forward the typed text to API-Football at query time. That endpoint:

| limitation | what the user saw |
|---|---|
| needs ≥ 3 characters | `ey` and `no` returned **nothing**, while `eyup`/`not` worked |
| compares raw, diacritic-sensitive substrings | `eyup` never matched **Eyüpspor**; `yildiz` never matched **Kenan Yıldız** |
| no ranking at all | `mil` returned Millwall before AC Milan; `yildiz` returned four amateurs before the Juventus player |
| no typo tolerance | `haland`, `bayren` → nothing |
| one upstream call per keystroke | up to **10** API-Football calls per search, the biggest single consumer of the quota |

None of that is patchable from outside: it is a query engine we do not control.
The previous workaround — a hand-written list of famous clubs and players in
`app/lib/popular.js` used to re-rank results — could only ever fix the individual
names someone had already thought to add.

So we keep the entities ourselves and rank them ourselves.

## The three pieces

```
scripts/seed-search.mjs ──▶ search_entities ──trigger──▶ search_terms
   (API-Football, batch)                                     │
   leagues → teams → squads → names                          ▼
                                                          search_all()
   client ──▶ /api/football?mode=search ──────────────────────┘ (one indexed query)
                       │
                       └──▶ API-Football /fixtures?team=<id>   (matches only, by ID)
```

**1. `supabase/migrate-search-index.sql`** — the index.

- `search_norm()` folds text to `[a-z0-9 ]`. It maps every cased letter explicitly
  instead of using `unaccent()`, because it must be `IMMUTABLE` and because
  `lower('İ')` outside a Turkish locale produces `i` + a combining dot, which
  would split the word.
- `search_entities` holds the documents; a trigger explodes each into
  `search_terms` — the whole name, each word, and each alias.
- Typeahead is a **btree range scan over `search_terms`**, so it works from a
  *single* character. A `pg_trgm` GIN index behind it handles typos, and a prefix
  backoff catches transpositions (`bayren` → Bayern) that trigrams cannot.
- Ranking is `match quality (0–100) + popularity (−30–100)`. Prefix hits always
  beat fuzzy hits; popularity only decides between comparable matches.
- A hit on an **alias** scores 7 below the same hit on the entity's own name.
  Without that, a player whose full legal name merely contains a word
  (`Abner Vinícius da Silva Santos`) ties with the player actually called that
  (`Vinícius Júnior`) and then wins on the shorter-name tiebreak.

**2. `scripts/seed-search.mjs`** — fills the index from API-Football in four
stages (leagues → teams → squads → names). Budgeted and resumable.

The fourth stage exists because `/players/squads` returns a *display* name, and
for exactly the famous players that is an abbreviation — Kenan Yıldız arrives as
`K. Yıldız`, Arda Güler as `A. Güler`. Indexed like that the surname is findable
and the first name is not, which was half the original complaint. `/players/profiles`
carries `firstname` + `lastname`, and paging through it unfiltered covers every
player at 250 a time, so ~2.7k calls fixes all ~28k of ours — far cheaper than
28k individual lookups.

Neither name is used as-is. The profile form is the full *legal* name
(`Vinícius José Paixão de Oliveira Júnior`), which nobody types and which dilutes
ranking. So `displayName()` keeps the squad name when it is already a real name
(`Vinícius Júnior`, `Bremer`, `Kylian Mbappé`) and only composes one — first given
name + surname — when the squad name is abbreviated. Every discarded spelling is
kept as an alias, so `t courtois` and `paixao` both still match.

**3. `app/api/football/route.js`, `mode=search`** — asks the index for teams,
players and venues, then fetches the match list from API-Football **by team id**,
never by text. Two teams that both resolve strongly (`fenerbahce besiktas`) get
head-to-head fixtures instead.

### The one thing still asked upstream

The index is built from *current squads*, so it does not carry retired players.
`zidane` would return nothing — something the old text-proxy search did handle. So
when the index finds **no player at all** and the query is ≥ 4 characters, the
route makes a single `/players/profiles?search=` call, cached for a day. Teams,
venues and leagues have no such fallback: those are indexed exhaustively.

If you would rather not have that call at all, seed the historical players instead
and delete the block — with a large API plan it is affordable, but it costs
roughly 10× the storage (see below).

## Popularity is derived, not curated

The one thing that decides `mil → AC Milan` and `yildiz → Kenan Yıldız` is
popularity, and it comes from structure:

- a **club** inherits the best competition it appears in (`LEAGUE_POP` in the
  seeder — ~50 competitions, by tier);
- because `search_upsert()` keeps the *greatest* value per entity, a club that
  also plays in Europe is lifted above its mid-table neighbours automatically;
- a **player** inherits his club (×0.85);
- reserve/youth/women sides get a *negative* popularity, so `Molde II` and
  `Real Madrid Castilla` always sink below the senior side.

Nobody is named anywhere in that. `app/lib/searchAliases.js` still exists, but it
is now only a **name dictionary** — translations (`İngiltere` = England),
nicknames (`cimbom`), short forms (`bjk`) — plus a fame floor for a handful of
clubs whose league tier understates them (Inter Miami, Al Nassr). Search works
with that file empty.

### …and it applies to CLUBS only

The seeder deliberately does not match players against that dictionary. Its player
entries are keyed by **surname** (`Vinicius`, `Son`, `Rodri`, `Yildiz`), and a
surname does not identify a person: matching by name handed Vinícius Júnior's
nicknames *and* his 92 fame rating to an unrelated Vinicius at RB Bragantino, who
then outranked the real one for his own nickname. Club names are distinctive
enough for this to be safe; personal names are not. Player popularity comes from
the club and nothing else.

## Cost

|  | before | after |
|---|---|---|
| API-Football calls per search | up to 10 | 0 for entities, ≤ 2 for fixtures (edge-cached) |
| latency | 300–1500 ms | ~5–15 ms in Postgres, plus one round trip |
| storage | — | ~100 MB (≈ 25k teams, ≈ 70k players, ≈ 575k terms) |
| ongoing API cost | grows with traffic | fixed: one seed, then a small nightly delta |

Measured on a local Postgres with 190k entities / 576k terms: 0.3 ms for `ar`,
3.4 ms for `kenan`, 12 ms for the worst case (a single-character query).

## Running it

**1. Apply the migration** — paste `supabase/migrate-search-index.sql` into the
Supabase SQL editor and run it, or:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrate-search-index.sql
```

**2. Put the credentials in `.env.seed`** (repo root; `.env*` is gitignored, and
`npm run search:seed` loads it automatically so the service-role key never ends up
in your shell history):

```
APISPORTS_KEY=<dashboard.api-football.com → Profile → API key>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Supabase → Project Settings → API keys → service_role>
```

**3. Seed.** Resumable and budgeted — safe on a small plan, just re-run it.

```bash
npm run search:seed -- --budget 4000 --rps 6
```

**4. Keep it fresh** — the same command *is* the refresh. Anything synced within
`--max-age` days is skipped, so a nightly small budget rolls through transfers:

```bash
npm run search:seed -- --budget 200 --max-age 14
```

Useful flags: `--stage leagues|teams|squads|names|all`, `--min-pop N`, `--rps N`,
`--dry`.

A full first seed is ~5,000 calls and ~35 minutes: 1 for the league list, ~1,240
league-seasons, ~1,080 squads, ~2,680 profile pages.

### How deep to index squads (`--min-pop`)

Every team in the world is indexed regardless — the flag only decides whose
**squad** is pulled, which is what drives both the call count and the storage.

| `--min-pop` | covers | seed calls | entities | storage |
|---|---|---|---|---|
| **58** (default) | top ~50 competitions | ~2,300 | ~75k | **~50–70 MB** |
| 40 | every league-type competition on earth | ~22,000 | ~650k | ~450–500 MB |

58 is the right default: it is the whole of European, South American and Asian
top-flight football plus every national side, and it fits inside a Supabase free
tier with room to spare. Going to 40 mostly adds players nobody searches for, and
would put a free-tier project at its 500 MB database limit. Raising coverage later
is incremental — already-synced teams are skipped.

Until the seeder has run, `mode=search` detects the empty index and falls back to
the old API-Football path, so deploying before seeding does not break search.

## Known limits and tunables

- **Clubs beat national sides by design.** Nations do not inherit their
  tournament's tier — that gave every World Cup qualifier 100, level with Real
  Madrid, so `no` answered Norway before Nottingham Forest. They take a flat
  `NATIONAL_POP` (62) instead, which still wins a name only they have
  (`ingiltere`, `arjantin`) and still beats lower-division clubs. Raise the
  constant and re-run `--stage teams` if you ever want the opposite.
- **Stadium nicknames are not indexed.** API-Football knows the Meazza as
  *Stadio Giuseppe Meazza*, so `san siro` does not find it, and `ulker` does not
  find Fenerbahçe's ground. Fixing this needs a venue alias dictionary, the same
  way `searchAliases.js` handles clubs.
- **Retired players** are not in the index — they are covered by the single
  cached upstream call described above.

### Tests

`scripts/test-search.mjs` replays every query that used to be wrong through the
real seeder mapping and the real SQL — no API key needed, just a Postgres with
the migration applied:

```bash
PGURI="postgres://…" node scripts/test-search.mjs
```

### After applying the migration

If `rpc/search_all` 404s, PostgREST has not picked up the new function yet —
reload the schema cache (Supabase dashboard → API → Reload, or
`notify pgrst, 'reload schema';`).
