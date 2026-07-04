-- ============================================================================
-- fikstür.com — Predictions & Reputation (v1)
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Idempotent (safe to re-run).
--
-- One coupon per user per match:
--   picks jsonb = {
--     "onextwo": "1" | "X" | "2",
--     "motm":    { "id": <playerId>, "name": "..." },
--     "ratings": [ { "id": <playerId>, "name": "...", "pred": 8.5 }, ... up to 3 ]
--   }
-- Scoring (done by the worker with the service role, which bypasses RLS):
--   1X2 correct = 3 ; MOTM correct = 10 ;
--   each rating: |pred-actual| <= 0.2 -> 5, <= 0.5 -> 3, <= 1.0 -> 1, else 0
--   (a player who didn't play / has no rating is neutral: not counted)
-- ============================================================================

-- ── predictions ─────────────────────────────────────────────────────────────
create table if not exists public.predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_id    text not null,
  match_ts    timestamptz,                 -- kickoff; predictions lock at this time
  league_id   text,
  sport       text not null default 'football',
  picks       jsonb not null,
  points      integer,                     -- null until scored
  scored      boolean not null default false,
  meta        jsonb,                       -- match snapshot (teams/score) for display
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, match_id)               -- one coupon per user per match
);
create index if not exists predictions_user_idx    on public.predictions (user_id, created_at desc);
create index if not exists predictions_match_idx    on public.predictions (match_id);
create index if not exists predictions_unscored_idx on public.predictions (match_id) where not scored;

drop trigger if exists predictions_set_updated_at on public.predictions;
create trigger predictions_set_updated_at before update on public.predictions
  for each row execute function public.set_updated_at();

alter table public.predictions enable row level security;
-- Picks stay private (users read only their own) so nobody can copy a coupon before lock.
drop policy if exists "predictions_select_own" on public.predictions;
create policy "predictions_select_own" on public.predictions for select using (auth.uid() = user_id);
drop policy if exists "predictions_insert_own" on public.predictions;
create policy "predictions_insert_own" on public.predictions for insert with check (auth.uid() = user_id);
drop policy if exists "predictions_update_own" on public.predictions;
create policy "predictions_update_own" on public.predictions for update using (auth.uid() = user_id);
drop policy if exists "predictions_delete_own" on public.predictions;
create policy "predictions_delete_own" on public.predictions for delete using (auth.uid() = user_id);

-- ── community leagues ────────────────────────────────────────────────────────
create table if not exists public.pred_leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null unique,        -- short join code
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create table if not exists public.pred_league_members (
  league_id   uuid not null references public.pred_leagues(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists pred_league_members_user_idx on public.pred_league_members (user_id);

alter table public.pred_leagues enable row level security;
alter table public.pred_league_members enable row level security;
-- Anyone signed in can look a league up by code (to join) and create one.
drop policy if exists "pred_leagues_select_all" on public.pred_leagues;
create policy "pred_leagues_select_all" on public.pred_leagues for select using (true);
drop policy if exists "pred_leagues_insert_own" on public.pred_leagues;
create policy "pred_leagues_insert_own" on public.pred_leagues for insert with check (auth.uid() = owner_id);
-- Membership is self-service: you add/remove only your own row.
drop policy if exists "pred_league_members_select_all" on public.pred_league_members;
create policy "pred_league_members_select_all" on public.pred_league_members for select using (true);
drop policy if exists "pred_league_members_insert_own" on public.pred_league_members;
create policy "pred_league_members_insert_own" on public.pred_league_members for insert with check (auth.uid() = user_id);
drop policy if exists "pred_league_members_delete_own" on public.pred_league_members;
create policy "pred_league_members_delete_own" on public.pred_league_members for delete using (auth.uid() = user_id);

-- ── leaderboards (security definer: aggregate everyone's points, expose no picks) ──
create or replace function public.pred_leaderboard_global(p_weekly boolean default false, p_limit int default 100)
returns table(user_id uuid, username text, points bigint, played bigint)
language sql security definer set search_path = public as $$
  select p.user_id,
         coalesce(pr.username, 'kullanıcı') as username,
         coalesce(sum(p.points), 0)::bigint as points,
         count(*) filter (where p.scored)::bigint as played
  from public.predictions p
  left join public.profiles pr on pr.id = p.user_id
  where p.scored
    and (not p_weekly or p.created_at >= date_trunc('week', now()))
  group by p.user_id, pr.username
  order by points desc
  limit p_limit;
$$;

create or replace function public.pred_leaderboard_league(p_league uuid, p_weekly boolean default false, p_limit int default 100)
returns table(user_id uuid, username text, points bigint, played bigint)
language sql security definer set search_path = public as $$
  select m.user_id,
         coalesce(pr.username, 'kullanıcı') as username,
         coalesce(sum(p.points), 0)::bigint as points,
         count(p.id) filter (where p.scored)::bigint as played
  from public.pred_league_members m
  left join public.profiles pr on pr.id = m.user_id
  left join public.predictions p on p.user_id = m.user_id and p.scored
    and (not p_weekly or p.created_at >= date_trunc('week', now()))
  where m.league_id = p_league
  group by m.user_id, pr.username
  order by points desc
  limit p_limit;
$$;

grant execute on function public.pred_leaderboard_global(boolean, int)  to anon, authenticated;
grant execute on function public.pred_leaderboard_league(uuid, boolean, int) to anon, authenticated;

-- ── rating consensus: community average player rating for a match (post-match "who was right?") ──
create or replace function public.match_rating_consensus(p_match text)
returns table(target_id text, avg_rating numeric, cnt bigint)
language sql security definer set search_path = public as $$
  select r.target_id, round(avg(r.rating)::numeric, 1) as avg_rating, count(*)::bigint as cnt
  from public.ratings r
  where r.match_id = p_match and r.target_type = 'player'
  group by r.target_id;
$$;
grant execute on function public.match_rating_consensus(text) to anon, authenticated;

-- ── Football DNA: a user's rating fingerprint (how much they rate, and how they diverge from the crowd) ──
create or replace function public.user_rating_profile(p_user uuid)
returns table(n bigint, avg_rating numeric, avg_diff numeric, avg_absdiff numeric)
language sql security definer set search_path = public as $$
  with mine as (
    select r.match_id, r.target_id, r.rating
    from public.ratings r
    where r.user_id = p_user and r.target_type = 'player'
  ),
  comm as (
    select r.match_id, r.target_id, avg(r.rating) as cavg
    from public.ratings r
    where r.target_type = 'player'
    group by r.match_id, r.target_id
  )
  select count(*)::bigint as n,
         round(avg(m.rating)::numeric, 2) as avg_rating,
         round(avg(m.rating - c.cavg)::numeric, 2) as avg_diff,
         round(avg(abs(m.rating - c.cavg))::numeric, 2) as avg_absdiff
  from mine m join comm c on c.match_id = m.match_id and c.target_id = m.target_id;
$$;
grant execute on function public.user_rating_profile(uuid) to anon, authenticated;

-- ── how many people made a prediction on each match (for the match-list "predictors" badge) ──
create or replace function public.match_prediction_counts(p_matches text[])
returns table(match_id text, cnt bigint)
language sql security definer set search_path = public as $$
  select p.match_id, count(*)::bigint as cnt
  from public.predictions p
  where p.match_id = any(p_matches)
  group by p.match_id;
$$;
grant execute on function public.match_prediction_counts(text[]) to anon, authenticated;
