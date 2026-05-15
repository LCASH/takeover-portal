-- Round 4 pentest fix. The previous rate-limit (check-count, then insert-row)
-- races: 30 parallel calls all read count=0 before any insert committed, and
-- 29 of 30 made it past the gate. Move the whole check+record into a single
-- SQL function that holds a transaction-scoped advisory lock keyed by IP, so
-- concurrent calls from the same IP serialise.

create or replace function public.try_record_signup_attempt(
  p_ip text,
  p_mobile text,
  p_email text,
  p_ua text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip_min int;
  v_ip_hr  int;
  v_mob    int;
  v_em     int;
  v_now    timestamptz := now();
begin
  -- Serialise concurrent attempts from the same IP at the transaction level.
  -- pg_try_advisory_xact_lock returns false immediately if another transaction
  -- already holds the lock; we treat that as "in flight, retry later".
  if not pg_try_advisory_xact_lock(hashtextextended('signup:' || p_ip, 0)) then
    return jsonb_build_object('ok', false, 'reason', 'concurrent', 'retry_seconds', 5);
  end if;

  select count(*) into v_ip_min from public.signup_attempts
    where key = 'ip:' || p_ip and attempted_at > v_now - interval '1 minute';
  if v_ip_min >= 5 then
    insert into public.signup_attempts (key, succeeded, user_agent, ip)
      values ('ip:' || p_ip, false, p_ua, p_ip);
    return jsonb_build_object('ok', false, 'reason', 'ip_minute', 'retry_seconds', 60);
  end if;

  select count(*) into v_ip_hr from public.signup_attempts
    where key = 'ip:' || p_ip and attempted_at > v_now - interval '1 hour';
  if v_ip_hr >= 20 then
    insert into public.signup_attempts (key, succeeded, user_agent, ip)
      values ('ip:' || p_ip, false, p_ua, p_ip);
    return jsonb_build_object('ok', false, 'reason', 'ip_hour', 'retry_seconds', 3600);
  end if;

  select count(*) into v_mob from public.signup_attempts
    where key = 'mobile:' || p_mobile and attempted_at > v_now - interval '10 minutes';
  if v_mob >= 2 then
    insert into public.signup_attempts (key, succeeded, user_agent, ip)
      values ('mobile:' || p_mobile, false, p_ua, p_ip);
    return jsonb_build_object('ok', false, 'reason', 'mobile', 'retry_seconds', 600);
  end if;

  select count(*) into v_em from public.signup_attempts
    where key = 'email:' || p_email and attempted_at > v_now - interval '10 minutes';
  if v_em >= 2 then
    insert into public.signup_attempts (key, succeeded, user_agent, ip)
      values ('email:' || p_email, false, p_ua, p_ip);
    return jsonb_build_object('ok', false, 'reason', 'email', 'retry_seconds', 600);
  end if;

  insert into public.signup_attempts (key, succeeded, user_agent, ip) values
    ('ip:' || p_ip,         false, p_ua, p_ip),
    ('mobile:' || p_mobile, false, p_ua, p_ip),
    ('email:' || p_email,   false, p_ua, p_ip);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.try_record_signup_attempt(text, text, text, text) from anon, authenticated, public;
grant execute on function public.try_record_signup_attempt(text, text, text, text) to service_role;

-- Also tighten the bowlers INSERT policy so authenticated users cannot set
-- admin-only columns at insert time (the existing trigger only fires on
-- UPDATE). Set the policy WITH CHECK to demand: status='lead',
-- login_enabled_at is null, auth_user_id matches the caller. Anon-insert is
-- not granted so this only applies to signed-in users (rare path; the live
-- portal uses the service-role edge function).
drop policy if exists "Allow authenticated insert as lead" on public.bowlers;
create policy "Allow authenticated insert as lead"
  on public.bowlers for insert
  to authenticated
  with check (
    status = 'lead'
    and login_enabled_at is null
    and (auth_user_id is null or auth_user_id = auth.uid())
    and account_owner_id is null
  );
