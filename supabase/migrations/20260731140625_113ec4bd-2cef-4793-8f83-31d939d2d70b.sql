
DROP POLICY IF EXISTS "event photos anon upload" ON storage.objects;
CREATE POLICY "event photos anon upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'event-photos');

DROP POLICY IF EXISTS "event photos auth read" ON storage.objects;
CREATE POLICY "event photos auth read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'event-photos');

DROP POLICY IF EXISTS "event photos auth delete" ON storage.objects;
CREATE POLICY "event photos auth delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'event-photos');
