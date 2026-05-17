-- UX fix: legit users who hit a network blip mid-signup got stuck because we
-- only allowed 2 attempts per 10 minutes per mobile/email. Bump to 3.
-- Edge function also gains a resume path for unfinished signups (separate
-- deploy) — this migration only updates the rate-limit numbers.

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
  if v_mob >= 3 then
    insert into public.signup_attempts (key, succeeded, user_agent, ip)
      values ('mobile:' || p_mobile, false, p_ua, p_ip);
    return jsonb_build_object('ok', false, 'reason', 'mobile', 'retry_seconds', 600);
  end if;

  select count(*) into v_em from public.signup_attempts
    where key = 'email:' || p_email and attempted_at > v_now - interval '10 minutes';
  if v_em >= 3 then
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
