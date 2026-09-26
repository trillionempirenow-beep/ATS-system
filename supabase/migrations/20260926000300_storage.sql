-- Supabase Storage buckets. All private: files are reached only through the
-- API, which checks access and hands out short-lived signed URLs.
-- Skipped automatically where the storage schema does not exist (local PGlite).

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('resumes', 'resumes', false, 10485760, array[
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/octet-stream','application/zip']),
      ('photos', 'photos', false, 3145728, array['image/jpeg','image/png','image/webp']),
      ('job-documents', 'job-documents', false, 8388608, array['application/pdf'])
    on conflict (id) do nothing;
  end if;
end $$;
