-- Letterboxd-style "favourite matches": up to 4 hand-picked match_ids shown at the top of the
-- profile, in order. Stored on the user's profile row (public read already covers profiles).
alter table public.profiles add column if not exists fav_matches jsonb not null default '[]'::jsonb;
