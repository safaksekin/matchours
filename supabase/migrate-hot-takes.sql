-- Hot takes: a user's player ratings that diverge most from the community (everyone else).
-- "You rated Haaland 6.0, the community says 8.4." Needs ≥2 OTHER raters for a real consensus.
create or replace function public.user_hot_takes(p_user uuid)
returns table (
  target_id   text,
  target_name text,
  match_id    text,
  user_rating numeric,
  avg_rating  numeric,
  cnt         bigint,
  diff        numeric
)
language sql stable as $$
  with community as (
    select match_id, target_id, avg(rating) as avg_rating, count(*) as cnt
    from public.ratings
    where target_type = 'player' and user_id <> p_user
    group by match_id, target_id
    having count(*) >= 2
  )
  select r.target_id,
         max(r.target_name) as target_name,
         r.match_id,
         r.rating as user_rating,
         c.avg_rating,
         c.cnt,
         abs(r.rating - c.avg_rating) as diff
  from public.ratings r
  join community c on c.match_id = r.match_id and c.target_id = r.target_id
  where r.user_id = p_user and r.target_type = 'player'
  group by r.target_id, r.match_id, r.rating, c.avg_rating, c.cnt
  order by diff desc
  limit 6;
$$;
