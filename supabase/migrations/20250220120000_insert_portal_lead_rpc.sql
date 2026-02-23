-- Portal landing form inserts via RPC so anon can add leads without relying on table RLS.
-- The anon INSERT policy can remain for other use; the portal uses this function.
create or replace function public.insert_portal_lead(
  p_full_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_mobile text,
  p_referrer text,
  p_country text,
  p_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.bowlers (
    full_name, first_name, last_name, email, mobile, referrer, country,
    status, organization_id
  ) values (
    p_full_name, p_first_name, p_last_name, p_email, p_mobile, p_referrer, p_country,
    'lead', p_organization_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.insert_portal_lead from public;
grant execute on function public.insert_portal_lead to anon;
grant execute on function public.insert_portal_lead to authenticated;

comment on function public.insert_portal_lead is 'Portal landing form: insert lead row; callable by anon.';
