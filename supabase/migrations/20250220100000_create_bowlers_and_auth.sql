-- Portal bowlers: single source for logins and stored details (separate from main TAKEOVER app).
-- Landing form creates a row with status=lead. Admin enables login (auth_user_id + login_enabled_at).
-- After onboarding form submit, status=onboarding_submitted; when we confirm, status=confirmed.

create table if not exists public.bowlers (
  id uuid primary key default gen_random_uuid(),
  -- From landing form
  email text not null,
  full_name text not null,
  first_name text not null,
  last_name text,
  mobile text not null,
  referrer text,
  country text not null,
  -- Auth: set when admin generates password or enables 2FA; required to log in
  auth_user_id uuid,
  login_enabled_at timestamptz,
  -- Onboarding form (required before they can do anything else in portal)
  date_of_birth date,
  address text,
  previous_betting_accounts text,
  banks_consent text[] default '{}',
  selfie_url text,
  license_front_url text,
  license_back_url text,
  accept_betting_tcs_at timestamptz,
  accept_bank_paypal_tcs_at timestamptz,
  confirm_details_entered_at timestamptz,
  -- Status: lead -> onboarding_submitted -> confirmed (we change to confirmed)
  status text not null default 'lead' check (status in ('lead', 'onboarding_submitted', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bowlers_email_key unique (email),
  constraint bowlers_mobile_key unique (mobile)
);

create index if not exists bowlers_auth_user_id_idx on public.bowlers (auth_user_id);
create index if not exists bowlers_status_idx on public.bowlers (status);
create index if not exists bowlers_country_idx on public.bowlers (country);
create index if not exists bowlers_created_at_idx on public.bowlers (created_at desc);

alter table public.bowlers enable row level security;

-- Anonymous can insert (landing form); application sends status=lead only
create policy "Allow anonymous insert as lead"
  on public.bowlers for insert
  to anon
  with check (true);

-- Authenticated (e.g. same browser with main app session) can insert leads only
create policy "Allow authenticated insert as lead"
  on public.bowlers for insert
  to authenticated
  with check (status = 'lead');

-- Authenticated user can read/update only their own row (by auth_user_id)
create policy "Bowlers read own"
  on public.bowlers for select
  to authenticated
  using (auth.uid() = auth_user_id);

create policy "Bowlers update own"
  on public.bowlers for update
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

-- Service role full access (admin, Edge Functions)
create policy "Service role full access bowlers"
  on public.bowlers
  to service_role
  using (true)
  with check (true);

-- Trigger to keep updated_at
create or replace function public.set_bowlers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bowlers_updated_at on public.bowlers;
create trigger bowlers_updated_at
  before update on public.bowlers
  for each row execute function public.set_bowlers_updated_at();

comment on table public.bowlers is 'Portal bowlers: logins and details; status lead -> onboarding_submitted -> confirmed';

-- Storage bucket for portal document uploads (selfie, license front/back)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-documents',
  'portal-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- RLS: authenticated user can upload/read only in their own folder (bowler id from bowlers where auth_user_id = user)
create policy "Portal docs upload own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'portal-documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.bowlers where auth_user_id = auth.uid()
    )
  );

create policy "Portal docs read own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'portal-documents'
    and (storage.foldername(name))[1] in (
      select id::text from public.bowlers where auth_user_id = auth.uid()
    )
  );

-- Note: auth_user_id is not a FK to auth.users to avoid cross-database reference issues in some environments.

-- Optional: migrate portal_submissions into bowlers (run once if you had data there)
-- insert into public.bowlers (email, full_name, first_name, mobile, referrer, country, status)
-- select email, full_name, first_name, mobile, referrer, country, 'lead'
-- from public.portal_submissions
-- on conflict (email) do nothing;
