-- Portal leads belong to one org (our landing page). Set PORTAL_ORGANIZATION_ID in env and in config.
alter table public.bowlers
  add column if not exists organization_id uuid references public.organizations(id);

create index if not exists bowlers_organization_id_idx on public.bowlers (organization_id);

comment on column public.bowlers.organization_id is 'Organization this lead/bowler belongs to (portal landing page org).';
