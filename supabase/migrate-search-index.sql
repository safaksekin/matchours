-- migrate-search-index.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- OWN SEARCH INDEX  (teams · players · venues · leagues)
--
-- Why this exists: search used to be proxied straight to API-Football's
-- `?search=` parameter at query time. That endpoint (a) needs >= 3 characters,
-- (b) matches raw diacritic-sensitive substrings, so "eyup" never finds
-- "Eyüpspor" and "yildiz" never finds "Kenan Yıldız", (c) has no ranking, so
-- "mil" returns Millwall before AC Milan, and (d) costs an upstream API call on
-- every keystroke. No amount of per-name patching fixes a query engine we do
-- not control, so we keep our own index and query it ourselves.
--
-- Shape: entities are documents; every document is exploded into normalised
-- TERMS (whole string + each word + each alias). Typeahead is then a btree
-- range scan over terms — which works from ONE character — with a pg_trgm GIN
-- index behind it for typo tolerance. Ranking = match quality + popularity,
-- where popularity is DERIVED from structure (league tier -> club -> squad),
-- not from a hand-written celebrity list.
--
-- Cost: zero API-Football calls per keystroke, one indexed DB query (~5-15 ms),
-- and ~50-70 MB of storage at the seeder's default depth. Writes are service-role
-- only; reads go through search_all(), which anon may execute.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

-- ── Normalisation ───────────────────────────────────────────────────────────
-- Fold to lowercase [a-z0-9 ]. Deliberately does NOT use unaccent(): we need an
-- IMMUTABLE function (it backs a generated/indexed value) and we need Turkish
-- handled correctly. lower('İ') in a non-Turkish locale yields "i" + U+0307,
-- which would split the word — so every cased letter is mapped explicitly here,
-- BEFORE lower() ever runs. Multi-character folds (ß -> ss) run first.
create or replace function public.search_norm(txt text)
returns text
language sql
immutable
parallel safe
as $fn$
  select btrim(regexp_replace(
    lower(translate(
      replace(replace(replace(replace(replace(replace(replace(replace(
        coalesce(txt, ''),
        'ß', 'ss'), 'ẞ', 'ss'),
        'æ', 'ae'), 'Æ', 'ae'),
        'œ', 'oe'), 'Œ', 'oe'),
        'þ', 'th'), 'Þ', 'th'),
      'ıİIşŞğĞøØđĐðÐłŁħĦŧŦŀĿĸſÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĠġĢģĤĥĨĩĪīĬĭĮįĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ',
      'iiissggooddddllhhttllksaaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggghhiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy'
    )),
    '[^a-z0-9]+', ' ', 'g'));
$fn$;

comment on function public.search_norm(text) is
  'Diacritic/Turkish-safe search folding: "Kenan Yıldız" -> "kenan yildiz", "Eyüpspor" -> "eyupspor".';

-- ── Documents ───────────────────────────────────────────────────────────────
create table if not exists public.search_entities (
  kind        text     not null check (kind in ('team','player','venue','league')),
  ext_id      integer  not null,                 -- API-Football id
  name        text     not null,                 -- display name (original spelling)
  subtitle    text,                              -- team -> country, player -> club
  image       text,
  country     text,
  aliases     text[]   not null default '{}',    -- native/short/alternate spellings
  -- 0..100 fame, derived at ingest from league tier (team) or club (player).
  -- Deliberately signed: reserve/youth/women variants get a NEGATIVE value so
  -- "Molde II" and "Real Madrid Castilla" sink below the senior side.
  popularity  smallint not null default 0,
  meta        jsonb    not null default '{}',    -- teamId, position, leagueId, ...
  updated_at  timestamptz not null default now(),
  primary key (kind, ext_id)
);

-- ── Terms (the actual typeahead index) ──────────────────────────────────────
-- `term` is COLLATE "C" on purpose: search_norm() only ever emits ASCII, and C
-- collation makes >=/< byte comparisons, so the prefix range scan below is a
-- plain, always-plannable btree range — no locale surprises, no LIKE-with-a-
-- variable-pattern problem.
create table if not exists public.search_terms (
  kind    text     not null,
  ext_id  integer  not null,
  term    text collate "C" not null,
  pos     smallint not null,   -- 0 = whole name/alias, 1..n = n-th word
  pop     smallint not null default 0,  -- denormalised from search_entities
  primary key (kind, ext_id, term),
  foreign key (kind, ext_id) references public.search_entities (kind, ext_id) on delete cascade
);

-- Did this term come ONLY from an alias, rather than from the entity's own name?
-- A hit on the real name has to outrank a hit on an alternate spelling, or a
-- player whose full legal name merely CONTAINS a word ("Abner Vinícius da Silva
-- Santos") ties with the player actually called that ("Vinícius Júnior") and then
-- wins on the shorter-name tiebreak.
alter table public.search_terms
  add column if not exists is_alias boolean not null default false;

create index if not exists search_terms_prefix_idx on public.search_terms (term, pop desc);
create index if not exists search_terms_trgm_idx   on public.search_terms using gin (term gin_trgm_ops);
create index if not exists search_entities_pop_idx on public.search_entities (kind, popularity desc);

-- Rebuild a document's terms whenever it is inserted/updated. Bulk seeding runs
-- in chunks, so per-row trigger cost is fine and correctness stays automatic.
create or replace function public.search_terms_sync()
returns trigger
language plpgsql
as $fn$
declare
  v_src text[];
begin
  delete from public.search_terms where kind = new.kind and ext_id = new.ext_id;
  v_src := array_prepend(new.name, coalesce(new.aliases, '{}'::text[]));

  -- v_src[1] is the entity's own name; everything after it is an alias, which is
  -- what `is_alias` records. bool_and() means a term counts as name-derived if it
  -- appears in the name at all, even when an alias repeats it.
  insert into public.search_terms (kind, ext_id, term, pos, pop, is_alias)
  select new.kind, new.ext_id, x.term, min(x.pos)::smallint, new.popularity, bool_and(x.is_alias)
  from (
    -- whole normalised name + each alias -> pos 0
    select public.search_norm(s.val) as term, 0 as pos, s.idx > 1 as is_alias
      from unnest(v_src) with ordinality as s(val, idx)
    union all
    -- every word of every source string -> pos = its 1-based index
    select w.word, least(w.idx, 9)::int, s.idx > 1
      from unnest(v_src) with ordinality as s(val, idx),
           lateral unnest(string_to_array(public.search_norm(s.val), ' '))
             with ordinality as w(word, idx)
  ) x
  where x.term is not null and x.term <> ''
  group by x.term;

  return new;
end;
$fn$;

drop trigger if exists search_entities_terms on public.search_entities;
create trigger search_entities_terms
  after insert or update of name, aliases, popularity on public.search_entities
  for each row execute function public.search_terms_sync();

-- ── Query ───────────────────────────────────────────────────────────────────
-- One round trip returns the top `per_kind` of every kind, already ranked.
--
--   score = match quality (0..100) + popularity (-30..100)
--
-- Match quality is ordered so that a prefix hit ALWAYS beats a fuzzy hit, and
-- popularity only decides between comparable matches. Worked example, q="mil":
--   Millwall     whole-name prefix 85 + pop 35  = 120
--   AC Milan     2nd-word   prefix 68 + pop 97  = 165  <- wins, with no per-name rule
drop function if exists public.search_all(text, int);
create function public.search_all(q text, per_kind int default 5)
returns table (
  kind text, ext_id int, name text, subtitle text,
  image text, country text, popularity int, meta jsonb, score real
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_q    text;
  v_hi   text;
  v_pref text;
  v_len  int;
begin
  v_q := public.search_norm(q);
  if v_q = '' then return; end if;
  v_len := length(v_q);
  v_hi  := v_q || chr(255);   -- exclusive upper bound of the prefix range (C collation)

  return query
  with hits as (
    -- prefix: btree range scan, usable from a SINGLE character.
    -- 1-2 char queries are restricted to well-known entities, both to keep the
    -- scan bounded and because "no" should mean Nottingham Forest, not the
    -- 4,000 obscure clubs that happen to start with those letters.
    select st.kind, st.ext_id,
           max((case
                 when st.term = v_q and st.pos = 0 then 100   -- exact whole name
                 when st.term = v_q                then  88   -- exact single word
                 when st.pos = 0                   then  85   -- whole name starts with q
                 when st.pos = 1                   then  76   -- first word starts with q
                 else                                    68   -- later word starts with q
               end
               -- an alternate spelling is weaker evidence than the real name
               - case when st.is_alias then 7 else 0 end))::real as m
      from public.search_terms st
     where st.term >= v_q and st.term < v_hi
       and (v_len > 2 or st.pop >= 40)
     group by st.kind, st.ext_id

    union all

    -- fuzzy: typo tolerance ("bayren" -> Bayern). Capped below every prefix
    -- score so it only ever surfaces what prefix matching could not find.
    select st.kind, st.ext_id, (30 + 30 * max(similarity(st.term, v_q)))::real
      from public.search_terms st
     where v_len >= 4 and st.term % v_q
     group by st.kind, st.ext_id
  ),
  best as (
    select h.kind, h.ext_id, max(h.m) as m
      from hits h
     group by h.kind, h.ext_id
  ),
  scored as (
    select e.kind, e.ext_id, e.name, e.subtitle, e.image, e.country,
           e.popularity::int as popularity, e.meta,
           (b.m + e.popularity)::real as score,
           row_number() over (
             partition by e.kind
             order by (b.m + e.popularity) desc, e.popularity desc, length(e.name), e.ext_id
           ) as rn
      from best b
      join public.search_entities e on e.kind = b.kind and e.ext_id = b.ext_id
  )
  select s.kind, s.ext_id, s.name, s.subtitle, s.image, s.country, s.popularity, s.meta, s.score
    from scored s
   where s.rn <= greatest(per_kind, 1)
   order by s.score desc;

  if found then return; end if;

  -- ── Nothing matched: "did you mean" backoff ───────────────────────────────
  -- Trigram similarity cannot rescue a transposition in a short word ("bayren"
  -- shares only one trigram with "bayern"), but typeahead typos overwhelmingly
  -- land in the TAIL of what was typed — the head is usually right. So retry the
  -- same prefix scan against progressively shorter prefixes and stop at the
  -- first that hits. Only reachable on a zero-result query, so it costs nothing
  -- in the normal path; scores are capped far below any real match and only
  -- popular entities qualify, so this reads as a suggestion, not a result.
  if v_len < 4 then return; end if;

  for i in reverse (v_len - 1) .. 3 loop
    v_pref := left(v_q, i);
    return query
    with cand as (
      select distinct st.kind, st.ext_id
        from public.search_terms st
       where st.term >= v_pref and st.term < v_pref || chr(255)
         and st.pop >= 40
    ),
    ranked as (
      select e.kind, e.ext_id, e.name, e.subtitle, e.image, e.country, e.popularity, e.meta,
             row_number() over (
               partition by e.kind order by e.popularity desc, length(e.name), e.ext_id
             ) as rn
        from cand c
        join public.search_entities e on e.kind = c.kind and e.ext_id = c.ext_id
    )
    select r.kind, r.ext_id, r.name, r.subtitle, r.image, r.country,
           r.popularity::int, r.meta, (20 + r.popularity)::real
      from ranked r
     where r.rn <= greatest(per_kind, 1)
     order by r.popularity desc;
    if found then return; end if;
  end loop;
end;
$fn$;

-- ── Seeder bookkeeping ──────────────────────────────────────────────────────
-- Lets the seed/refresh job be resumable and budgeted: it records what has
-- already been pulled so a run that stops at its API-call budget picks up
-- exactly where it left off on the next run.
create table if not exists public.search_sync_state (
  scope      text primary key,              -- 'leagues' | 'teams:<leagueId>' | 'squad:<teamId>'
  synced_at  timestamptz not null default now(),
  status     text not null default 'ok',
  meta       jsonb not null default '{}'
);

-- ── Ingest ──────────────────────────────────────────────────────────────────
-- Bulk upsert used by the seeder. Not a plain PostgREST upsert because the
-- merge rules are not "last write wins": the same club is seen once per
-- competition it plays in, so popularity must take the BEST tier it reaches
-- (Real Madrid seen via La Liga and via the Champions League keeps 100), and
-- aliases accumulate instead of replacing each other. A negative popularity
-- (reserve/youth/women side) always sticks — it is a classification, not a score.
create or replace function public.search_upsert(rows jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count int;
begin
  with incoming as (
    select
      r->>'kind'                                   as kind,
      (r->>'ext_id')::int                          as ext_id,
      r->>'name'                                   as name,
      r->>'subtitle'                               as subtitle,
      r->>'image'                                  as image,
      r->>'country'                                as country,
      coalesce(
        (select array_agg(a) from jsonb_array_elements_text(r->'aliases') a),
        '{}'::text[]
      )                                            as aliases,
      coalesce((r->>'popularity')::smallint, 0)    as popularity,
      coalesce(r->'meta', '{}'::jsonb)             as meta
    from jsonb_array_elements(rows) r
    where r->>'kind' is not null and r->>'ext_id' is not null and r->>'name' is not null
  ),
  -- one row per key: the same payload can carry a club twice (e.g. two squads)
  deduped as (
    select distinct on (kind, ext_id) * from incoming order by kind, ext_id, popularity desc
  )
  insert into public.search_entities as e
        (kind, ext_id, name, subtitle, image, country, aliases, popularity, meta, updated_at)
  select kind, ext_id, name, subtitle, image, country, aliases, popularity, meta, now()
    from deduped
  on conflict (kind, ext_id) do update set
    name       = excluded.name,
    subtitle   = coalesce(excluded.subtitle, e.subtitle),
    image      = coalesce(excluded.image,    e.image),
    country    = coalesce(excluded.country,  e.country),
    aliases    = (select coalesce(array_agg(distinct a), '{}'::text[])
                    from unnest(e.aliases || excluded.aliases) a
                   where a is not null and a <> ''),
    popularity = case when excluded.popularity < 0 or e.popularity < 0
                      then least(e.popularity, excluded.popularity)
                      else greatest(e.popularity, excluded.popularity) end,
    meta       = e.meta || excluded.meta,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- ── Access ──────────────────────────────────────────────────────────────────
-- Same posture as api_cache: RLS on, no policies, so only the service role (used
-- by the seeder and the Worker) can read/write the tables directly. Clients get
-- read access exclusively through search_all(), which is SECURITY DEFINER.
alter table public.search_entities   enable row level security;
alter table public.search_terms      enable row level security;
alter table public.search_sync_state enable row level security;

grant execute on function public.search_all(text, int)  to anon, authenticated;
grant execute on function public.search_norm(text)      to anon, authenticated;

-- search_upsert is a WRITE path: Postgres grants EXECUTE to PUBLIC by default,
-- so it must be revoked explicitly or the anon key could rewrite the index.
revoke all on function public.search_upsert(jsonb) from public;
revoke all on function public.search_upsert(jsonb) from anon, authenticated;

-- ── Rebuild ─────────────────────────────────────────────────────────────────
-- Terms are derived data, so re-applying this file has to regenerate them or an
-- already-seeded index keeps whatever the previous trigger produced. Touching
-- `name` fires search_entities_terms for every row; on a fresh install the table
-- is empty and this costs nothing. Safe to run any number of times.
--
-- Split per kind so no single statement runs long enough to hit a dashboard
-- statement timeout — the whole rebuild is ~25 s per 100k rows. If one of these
-- does time out, just run that line again on its own; the trigger is idempotent.
update public.search_entities set name = name where kind = 'league';
update public.search_entities set name = name where kind = 'venue';
update public.search_entities set name = name where kind = 'team';
update public.search_entities set name = name where kind = 'player';
