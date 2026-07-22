-- Adds league_id to match_logs so a logged match remembers its EXACT numeric API-Football league id
-- (not just the `league` display name), so features like the native app's Favori Dörtlü league-logo
-- badge can look the logo up by id and don't depend on name-matching a text field that isn't always
-- stamped consistently across every fetch path. Run once in the Supabase SQL editor. Safe to re-run.

alter table public.match_logs add column if not exists league_id integer;
