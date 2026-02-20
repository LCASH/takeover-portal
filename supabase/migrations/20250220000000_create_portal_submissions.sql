-- Portal submissions: one row per unique person (email and mobile must be unique).
create table if not exists public.portal_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  first_name text not null,
  email text not null,
  mobile text not null,
  referrer text,
  country text not null,
  created_at timestamptz not null default now(),
  constraint portal_submissions_email_key unique (email),
  constraint portal_submissions_mobile_key unique (mobile)
);

-- Index for searchable country (e.g. filter by country in dashboard).
create index if not exists portal_submissions_country_idx on public.portal_submissions (country);
create index if not exists portal_submissions_created_at_idx on public.portal_submissions (created_at desc);

-- Allow anonymous inserts (e.g. from landing page); restrict read/update/delete.
alter table public.portal_submissions enable row level security;

create policy "Allow anonymous insert"
  on public.portal_submissions for insert
  to anon
  with check (true);

create policy "No public read"
  on public.portal_submissions for select
  to anon
  using (false);

-- Service role can do anything (dashboard, Edge Functions).
create policy "Service role full access"
  on public.portal_submissions
  to service_role
  using (true)
  with check (true);

comment on table public.portal_submissions is 'Landing page signups; one submission per unique email/mobile.';
