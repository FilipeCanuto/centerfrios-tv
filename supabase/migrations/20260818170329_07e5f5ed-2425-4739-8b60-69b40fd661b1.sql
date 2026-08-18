DROP FUNCTION IF EXISTS public.register_tv(text);

DROP POLICY IF EXISTS "event photos anon upload" ON storage.objects;
CREATE POLICY "event photos anon upload"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'event-photos'
  AND (storage.foldername(name))[1] = 'evento'
  AND array_length(storage.foldername(name), 1) = 1
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp')
  AND (
    metadata IS NULL
    OR (
      COALESCE((metadata->>'size')::bigint, 0) <= 3145728
      AND COALESCE(metadata->>'mimetype', 'image/jpeg') IN ('image/jpeg','image/png','image/webp')
    )
  )
);