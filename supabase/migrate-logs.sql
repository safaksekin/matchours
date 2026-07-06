-- Match Log: the app's spine. One row per (user, match): a 0-10 match rating +
-- style tags. Player performance ratings continue to live in `ratings`.
-- Public SELECT is intentional so aggregate identity features ("The Split",
-- community consensus, Taste-Graph benchmarks) can read across users. Writes are own-only.

create table if not exists public.match_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  match_id   text not null,
  rating     numeric(3,1) not null check (rating >= 0 and rating <= 10),
  tags       jsonb not null default '[]'::jsonb,
  players    jsonb not null default '[]'::jsonb,  -- [{pos,rating,side}] of the rated players → role axes
  attended   boolean not null default false,      -- true = watched at the stadium (check-in) vs on a screen
  venue      text,                                -- the ground, stored when attended → Stadiums collection
  photo      text,                                -- one photo from the ground (public URL in the log-photos bucket)
  home       text,
  away       text,
  home_logo  text,
  away_logo  text,
  score      text,
  league     text,
  match_ts   timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);

-- for installs created before these columns existed:
alter table public.match_logs add column if not exists players  jsonb not null default '[]'::jsonb;
alter table public.match_logs add column if not exists attended boolean not null default false;
alter table public.match_logs add column if not exists venue    text;
alter table public.match_logs add column if not exists photo     text;
alter table public.match_logs add column if not exists home_logo text;
alter table public.match_logs add column if not exists away_logo text;
alter table public.match_logs add column if not exists score     text;

create index if not exists match_logs_match_idx on public.match_logs (match_id);
create index if not exists match_logs_user_idx  on public.match_logs (user_id, created_at desc);

alter table public.match_logs enable row level security;

drop policy if exists match_logs_read_all   on public.match_logs;
drop policy if exists match_logs_insert_own on public.match_logs;
drop policy if exists match_logs_update_own on public.match_logs;
drop policy if exists match_logs_delete_own on public.match_logs;

create policy match_logs_read_all   on public.match_logs for select using (true);
create policy match_logs_insert_own on public.match_logs for insert with check (auth.uid() = user_id);
create policy match_logs_update_own on public.match_logs for update using (auth.uid() = user_id);
create policy match_logs_delete_own on public.match_logs for delete using (auth.uid() = user_id);
