-- Seguimiento en camino: hora de salida, llegada estimada y aviso de retraso.
alter table public.services add column if not exists on_the_way_at timestamptz;
alter table public.services add column if not exists expected_arrival_at timestamptz;
alter table public.services add column if not exists late_notified_at timestamptz;

create index if not exists services_on_the_way_idx
  on public.services (status)
  where status = 'on_the_way' and late_notified_at is null;
