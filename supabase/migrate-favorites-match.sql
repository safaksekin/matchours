-- Allow saving a MATCH (not just teams/players) to favorites.
-- Run once in the Supabase SQL editor. Until this runs, the save button on match
-- cards works optimistically but the row won't persist (insert is rejected by the
-- old kind check).
alter table public.favorites drop constraint if exists favorites_kind_check;
alter table public.favorites add constraint favorites_kind_check
  check (kind in ('team','player','match'));
