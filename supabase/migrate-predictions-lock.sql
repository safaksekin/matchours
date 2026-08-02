-- ============================================================================
-- Predictions hardening (audit 2026-08-01): kickoff lock + score integrity +
-- private league codes. Run once in Supabase SQL Editor. Idempotent.
-- Pairs with app/lib/db.js switching joinPredLeague to the join_pred_league RPC.
-- ============================================================================

-- 1) points/scored/rated were client-writable (the "update own" policy limits
-- rows, not columns) — a user could hand himself points. Only the scoring
-- worker (service_role, bypasses these grants) may write them.
revoke update on public.predictions from anon, authenticated;
grant update (picks, meta) on public.predictions to authenticated;

revoke insert on public.predictions from anon, authenticated;
grant insert (user_id, match_id, match_ts, league_id, sport, picks, meta)
  on public.predictions to authenticated;

-- 2) The promised kickoff lock, actually enforced: no edits or deletes once
-- the match has started (match_ts null = unknown kickoff, stays editable).
drop policy if exists "predictions_update_own" on public.predictions;
create policy "predictions_update_own" on public.predictions for update
  using (auth.uid() = user_id and (match_ts is null or now() < match_ts))
  with check (auth.uid() = user_id and (match_ts is null or now() < match_ts));

drop policy if exists "predictions_delete_own" on public.predictions;
create policy "predictions_delete_own" on public.predictions for delete
  using (auth.uid() = user_id and (match_ts is null or now() < match_ts));

-- 3) pred_leagues.code (the private join code) was select-all readable —
-- anyone could enumerate codes and walk into private leagues. Visible only
-- to the owner and members; joining goes through a definer function that
-- checks the code server-side without ever exposing the list.
drop policy if exists "pred_leagues_select_all" on public.pred_leagues;
create policy "pred_leagues_select_member" on public.pred_leagues for select
  using (
    auth.uid() = owner_id
    or exists (select 1 from public.pred_league_members m
               where m.league_id = id and m.user_id = auth.uid())
  );

create or replace function public.join_pred_league(p_code text)
returns table(id uuid, name text, code text, owner_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  lg public.pred_leagues%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;
  select * into lg from public.pred_leagues l where upper(l.code) = upper(trim(p_code));
  if not found then
    return; -- empty result = wrong code
  end if;
  insert into public.pred_league_members (league_id, user_id)
  values (lg.id, auth.uid())
  on conflict (league_id, user_id) do nothing;
  return query select lg.id, lg.name, lg.code, lg.owner_id;
end;
$$;
grant execute on function public.join_pred_league(text) to authenticated;
