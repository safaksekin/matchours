-- Likes on a logged match (community feed post). One like per user per log, powering the heart +
-- count on the native app's Global feed card. Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_id     uuid not null references public.match_logs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, log_id)
);

create index if not exists likes_log_idx on public.likes (log_id);

alter table public.likes enable row level security;

drop policy if exists "likes_select_all" on public.likes;
create policy "likes_select_all" on public.likes for select using (true);   -- public like counts

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own" on public.likes for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own" on public.likes for delete using (auth.uid() = user_id);
