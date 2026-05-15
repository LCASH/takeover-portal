-- EMERGENCY LOCKDOWN: revoke anon (and public) access on every table in public schema.
-- Cause: external audit confirmed anon could SELECT 228 account_owners (full PII incl.
-- plaintext bowler_password and bet365_password, DOB, driver licence, medicare numbers,
-- addresses, bank balances), 5052 betting_accounts, 112 proxies, and the
-- organization_members row exposing the owner auth user id.
-- The portal app does not need anon table access — anon talks to the
-- signup-and-auth and send-portal-sms edge functions; everything else is done
-- as the signed-in user via bowlers RLS policies.

-- 1. Make sure RLS is enabled on every table in public.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- 2. Revoke every table privilege from anon and public on every table in public.
--    RLS would already block reads, but defence in depth: revoke the grant too,
--    so a missing or accidentally-permissive policy can't expose anything.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke all on public.%I from anon, public', r.relname);
  end loop;
end $$;

-- 3. Revoke all routine execution from anon/public; we'll re-grant only what the
--    landing form needs. authenticated role keeps its existing grants.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function public.%I(%s) from anon, public', r.proname, r.args);
  end loop;
end $$;

-- 4. Re-grant only what's intentionally callable by anon.
--    The portal landing form calls the signup-and-auth edge function (server-side
--    service-role insert), so anon does not need direct INSERT on bowlers.
--    Keep insert_portal_lead callable by anon only if a legacy code path uses it.
grant execute on function public.insert_portal_lead(
  p_full_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_mobile text,
  p_referrer text,
  p_country text,
  p_organization_id uuid
) to anon, authenticated;

-- 5. Column-level revokes for stored plaintext credentials. Even if a future
--    RLS policy lets authenticated users SELECT their own row, these columns
--    must never be readable outside service_role. The columns themselves
--    should be removed in a follow-up migration once the resume-auth flow
--    no longer needs them.
do $$
declare
  col record;
begin
  for col in
    select * from (values
      ('bowlers',        'encrypted_password'),
      ('account_owners', 'bowler_password'),
      ('account_owners', 'bet365_password'),
      ('account_owners', 'bank_password'),
      ('account_owners', 'access_code'),
      ('account_owners', 'security_code')
    ) as t(tbl, col)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=col.tbl and column_name=col.col
    ) then
      execute format('revoke select (%I) on public.%I from anon, authenticated, public', col.col, col.tbl);
    end if;
  end loop;
end $$;

-- 6. Sanity check helper: a view listing tables with RLS off (none expected).
--    Query this after migration: select * from public._rls_audit;
create or replace view public._rls_audit as
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

revoke all on public._rls_audit from anon, public;
grant select on public._rls_audit to authenticated, service_role;

comment on view public._rls_audit is 'Audit helper: lists public tables and their RLS state. Anon must never have SELECT on this view.';
