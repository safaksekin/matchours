-- Allow saving a COACH to favorites (from a match lineup) — extends the kind check.
alter table public.favorites drop constraint if exists favorites_kind_check;
alter table public.favorites add constraint favorites_kind_check
  check (kind in ('team','player','match','coach'));
