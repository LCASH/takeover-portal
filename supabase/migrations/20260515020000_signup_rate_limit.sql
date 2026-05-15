-- Round 3 pentest found that signup-and-auth has no rate limit: 10 concurrent
-- signups completed in 2 seconds, each persisting state and triggering an SMS.
-- This table backs a per-IP and per-mobile-prefix rate check in the edge fn.

create table if not exists public.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false,
  user_agent text,
  ip text
);

create index if not exists signup_attempts_key_time_idx
  on public.signup_attempts (key, attempted_at desc);

alter table public.signup_attempts enable row level security;

-- Anon/authenticated never read or write this directly; only service_role
-- (from the edge function) touches it.
revoke all on public.signup_attempts from anon, authenticated, public;
grant all on public.signup_attempts to service_role;

-- Auto-prune rows older than 24 hours so the table doesn't grow unbounded.
-- Run periodically via pg_cron or a scheduled edge function. Manual one-liner:
--   delete from public.signup_attempts where attempted_at < now() - interval '24 hours';
create or replace function public.prune_signup_attempts()
returns void
language sql
as $$
  delete from public.signup_attempts where attempted_at < now() - interval '24 hours';
$$;
revoke all on function public.prune_signup_attempts() from anon, authenticated, public;
grant execute on function public.prune_signup_attempts() to service_role;
