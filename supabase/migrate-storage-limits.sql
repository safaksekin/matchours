-- ============================================================================
-- Storage hardening (audit 2026-08-01, item 3.3): the public avatars and
-- log-photos buckets had no size or MIME limits — any authenticated user
-- could park arbitrary files of arbitrary size there.
-- Run once in Supabase SQL Editor. Idempotent.
-- ============================================================================

update storage.buckets
   set file_size_limit = 5242880,               -- 5 MB per file
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('avatars', 'log-photos');
