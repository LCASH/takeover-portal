-- Refine the bowlers_block_self_promotion trigger to stop blocking legitimate flows:
--   * Bowler completing portal step 2 → sets status to 'onboarding_submitted' on their own row.
--   * Admin moving a bowler around the Portal Leads kanban → sets status to anything allowed.
-- The previous trigger (20260515010000_pentest_fixes.sql) treated EVERY non-service-role
-- status / login_enabled_at change as an attack, which broke both of the above.
--
-- New rules:
--   service_role           → any update (signup-and-auth + enable-portal-login bypass)
--   bowler on own row      → may set status only from 'lead' → 'onboarding_submitted'
--                            (still cannot self-promote to 'confirmed', cannot set
--                            login_enabled_at, auth_user_id, organization_id,
--                            account_owner_id)
--   org owner/admin        → may set status to any allowed value; may set
--                            login_enabled_at. Still CANNOT modify auth_user_id
--                            or organization_id (those re-point a bowler row at
--                            a different identity / tenant — service-role only).
--   everyone else          → rejected (42501)
--
-- The pentest attack (sign up, PATCH status=confirmed) still fails because the
-- attacker is the bowler on their own row, and 'lead' → 'confirmed' is not the
-- allowed transition.

create or replace function public.bowlers_block_self_promotion()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
begin
  if current_user = 'service_role' then
    return new;
  end if;

  v_uid := auth.uid();

  -- Is the caller an owner/admin of the bowler's org?
  if old.organization_id is not null then
    select exists (
      select 1 from public.organization_members
      where organization_id = old.organization_id
        and user_id = v_uid
        and role in ('owner', 'admin')
    ) into v_is_admin;
  else
    v_is_admin := false;
  end if;

  -- auth_user_id / organization_id are immutable for everyone except service_role.
  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'auth_user_id is admin-only' using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is admin-only' using errcode = '42501';
  end if;

  -- account_owner_id and login_enabled_at: admins can set, bowlers cannot.
  if (new.account_owner_id is distinct from old.account_owner_id) and not v_is_admin then
    raise exception 'account_owner_id can only be set by an org admin' using errcode = '42501';
  end if;
  if (new.login_enabled_at is distinct from old.login_enabled_at) and not v_is_admin then
    raise exception 'login_enabled_at can only be set by an org admin' using errcode = '42501';
  end if;

  -- status: admins → anything; bowler on own row → only lead → onboarding_submitted.
  if new.status is distinct from old.status then
    if v_is_admin then
      -- any allowed status (table CHECK constraint already enforces the enum)
      null;
    elsif v_uid is not null and v_uid = old.auth_user_id
       and old.status = 'lead' and new.status = 'onboarding_submitted' then
      null;
    else
      raise exception 'status change not allowed for this role / transition' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Re-create the trigger so it picks up the new function body cleanly.
drop trigger if exists bowlers_block_self_promotion on public.bowlers;
create trigger bowlers_block_self_promotion
  before update on public.bowlers
  for each row execute function public.bowlers_block_self_promotion();
