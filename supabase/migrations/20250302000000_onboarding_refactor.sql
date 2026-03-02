-- Onboarding refactor: two-step signup flow on landing page.
-- Adds consent video, encrypted password for credentials SMS, and video support in storage.

-- New columns
ALTER TABLE public.bowlers
  ADD COLUMN IF NOT EXISTS consent_video_url text,
  ADD COLUMN IF NOT EXISTS encrypted_password text,
  ADD COLUMN IF NOT EXISTS credentials_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS credentials_sms_error text,
  ADD COLUMN IF NOT EXISTS required_form_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_stage text,
  ADD COLUMN IF NOT EXISTS landing_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS landing_sms_error text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_bsb text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_pay_id text,
  ADD COLUMN IF NOT EXISTS end_partnership_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_partnership_reason text;

-- Expand status to include 'unqualified'
ALTER TABLE public.bowlers DROP CONSTRAINT IF EXISTS bowlers_status_check;
ALTER TABLE public.bowlers
  ADD CONSTRAINT bowlers_status_check
  CHECK (status IN ('lead', 'onboarding_submitted', 'confirmed', 'unqualified'));

-- Update storage bucket: allow video MIME types and increase size limit for video uploads (50MB)
UPDATE storage.buckets
SET
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'video/mp4', 'video/webm', 'video/quicktime'
  ],
  file_size_limit = 52428800
WHERE id = 'portal-documents';

-- Storage: allow authenticated users to update (upsert) their own documents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Portal docs update own' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Portal docs update own"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'portal-documents'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.bowlers WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;
