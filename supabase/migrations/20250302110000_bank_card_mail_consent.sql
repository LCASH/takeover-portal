-- Add consent timestamp for bank card by mail acknowledgement.

ALTER TABLE public.bowlers
  ADD COLUMN IF NOT EXISTS accept_bank_card_mail_at timestamptz;

COMMENT ON COLUMN public.bowlers.accept_bank_card_mail_at IS 'Timestamp when bowler acknowledged they will receive a bank card, share details, and cut it up';
