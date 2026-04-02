-- Add new ID document columns (medicare, passport) and consent timestamps.
-- Replaces single selfie + front/back with 3-option ID verification (need 2 of 3).

ALTER TABLE public.bowlers
  ADD COLUMN IF NOT EXISTS medicare_url text,
  ADD COLUMN IF NOT EXISTS passport_url text,
  ADD COLUMN IF NOT EXISTS accept_paypal_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS accept_cooperation_at timestamptz;

COMMENT ON COLUMN public.bowlers.medicare_url IS 'Upload path for Medicare card image';
COMMENT ON COLUMN public.bowlers.passport_url IS 'Upload path for passport photo page image';
COMMENT ON COLUMN public.bowlers.accept_paypal_consent_at IS 'Timestamp when bowler consented to PayPal account management';
COMMENT ON COLUMN public.bowlers.accept_cooperation_at IS 'Timestamp when bowler accepted cooperation notice';
