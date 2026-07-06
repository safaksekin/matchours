-- Stadium check-in photos: a public bucket where a user can attach ONE photo to a log.
-- Files are stored at  {user_id}/{match_id}-{ts}.{ext}  so ownership = first path segment.

insert into storage.buckets (id, name, public)
values ('log-photos', 'log-photos', true)
on conflict (id) do nothing;

drop policy if exists "log_photos_public_read"  on storage.objects;
drop policy if exists "log_photos_own_insert"   on storage.objects;
drop policy if exists "log_photos_own_update"   on storage.objects;
drop policy if exists "log_photos_own_delete"   on storage.objects;

create policy "log_photos_public_read" on storage.objects
  for select using (bucket_id = 'log-photos');

create policy "log_photos_own_insert" on storage.objects
  for insert with check (bucket_id = 'log-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "log_photos_own_update" on storage.objects
  for update using (bucket_id = 'log-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "log_photos_own_delete" on storage.objects
  for delete using (bucket_id = 'log-photos' and auth.uid()::text = (storage.foldername(name))[1]);
