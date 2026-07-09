-- ============================================================================
-- fikstür.com — Supabase schema
-- Run this in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (idempotent: "if not exists" / "drop ... if exists" / "or replace").
-- ============================================================================

-- Generic "touch updated_at on UPDATE" helper.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) PROFILES
-- App-level user data that extends Supabase Auth's built-in `auth.users`.
-- NOTE: credentials (email + hashed password) are stored & managed by Supabase
-- Auth itself in auth.users — never store passwords here.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text,
  is_premium  boolean not null default false,            -- "premium mü" — şimdilik false (boş) başlar
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: create profiles for users who signed up before this table existed.
insert into public.profiles (id, username)
select u.id, coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2) RATINGS
-- A user's 0–10 rating of a match OR a player. Player ratings are per-match
-- (the same player can be rated differently in different games).
--   target_type : 'match' | 'player'
--   target_id   : API-Football match id  OR  player id
--   match_id    : context — for 'match' it equals target_id; for 'player' it's the match rated in
-- ----------------------------------------------------------------------------
create table if not exists public.ratings (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  target_type  text not null check (target_type in ('match','player')),
  target_id    text not null,
  match_id     text not null,
  target_name  text,                                     -- denormalized for display ("Arda Güler" / "PSG - Real Madrid")
  sport        text not null default 'football',
  rating       numeric(3,1) not null check (rating >= 0 and rating <= 10),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, target_type, target_id, match_id)     -- one rating per user per target (per match) -> upsert to change
);

create index if not exists ratings_target_idx on public.ratings (target_type, target_id, match_id);
create index if not exists ratings_user_idx   on public.ratings (user_id);

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at before update on public.ratings
  for each row execute function public.set_updated_at();

alter table public.ratings enable row level security;

drop policy if exists "ratings_select_all" on public.ratings;
create policy "ratings_select_all" on public.ratings for select using (true);  -- public, for averages

drop policy if exists "ratings_insert_own" on public.ratings;
create policy "ratings_insert_own" on public.ratings for insert with check (auth.uid() = user_id);

drop policy if exists "ratings_update_own" on public.ratings;
create policy "ratings_update_own" on public.ratings for update using (auth.uid() = user_id);

drop policy if exists "ratings_delete_own" on public.ratings;
create policy "ratings_delete_own" on public.ratings for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3) COMMENTS
-- A user's free-text note on a match OR a player (per-match for players).
-- ----------------------------------------------------------------------------
create table if not exists public.comments (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  target_type  text not null check (target_type in ('match','player')),
  target_id    text not null,
  match_id     text,                                     -- context: which match (for player comments)
  target_name  text,
  match_name   text,                      -- "Home - Away" of the match this comment belongs to
  meta         jsonb,                      -- snapshot: logos, score, player stats (for the community feed quote card)
  sport        text not null default 'football',
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
-- If the comments table already exists, add the new columns:
alter table public.comments add column if not exists match_name text;
alter table public.comments add column if not exists meta jsonb;

create index if not exists comments_target_idx on public.comments (target_type, target_id, match_id);
create index if not exists comments_user_idx    on public.comments (user_id);
create index if not exists comments_created_idx on public.comments (created_at desc);

alter table public.comments enable row level security;

drop policy if exists "comments_select_all" on public.comments;
create policy "comments_select_all" on public.comments for select using (true);

drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments for insert with check (auth.uid() = user_id);

drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments for update using (auth.uid() = user_id);

drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments for delete using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- api_cache: persistent cache for immutable API-Football responses (finished
-- matches, past seasons, player match stats, etc). Keyed by the API path, so
-- one table holds every response type — value is the raw JSON `response`.
-- The server (Cloudflare Worker) reads/writes this with the SERVICE ROLE key,
-- which bypasses RLS; no anon policies => the public anon key cannot touch it.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.api_cache (
  key         text primary key,         -- the API path, e.g. "/fixtures/players?fixture=12345"
  payload     jsonb not null,           -- raw API `response` array/object
  expires_at  timestamptz,              -- null = never expires (truly immutable, e.g. finished match)
  created_at  timestamptz not null default now()
);
create index if not exists api_cache_expires_idx on public.api_cache (expires_at);
alter table public.api_cache enable row level security;
-- (intentionally no policies — only the service-role key, used server-side, may read/write)

-- ──────────────────────────────────────────────────────────────────────────
-- favorites: a user's saved teams & players (shown in the Favorites tab / profile)
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('team','player','match','coach')),
  ref_id      text not null,            -- team id, player id, match id or coach id
  name        text,
  image       text,                     -- team logo or player photo
  meta        jsonb,                    -- extra: position, country, etc.
  created_at  timestamptz not null default now(),
  unique (user_id, kind, ref_id)
);
create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);
alter table public.favorites enable row level security;
drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites for select using (auth.uid() = user_id);
drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites for insert with check (auth.uid() = user_id);
drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites for delete using (auth.uid() = user_id);
