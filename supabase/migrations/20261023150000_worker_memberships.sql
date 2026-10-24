-- SERCOM Pro: membresía mensual de profesionales pagada con Wompi.
-- Solo agrega una tabla nueva.

create table if not exists public.worker_memberships (
  id                      uuid primary key default gen_random_uuid(),
  worker_id               uuid not null references public.profiles(id) on delete cascade,
  plan                    text not null default 'pro',
  status                  text not null default 'pending'
                          check (status in ('pending', 'active', 'failed', 'cancelled')),
  amount                  numeric not null,
  period_start            timestamptz,
  period_end              timestamptz,
  checkout_reference      text,
  provider_transaction_id text,
  provider_status         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists worker_memberships_active_idx
  on public.worker_memberships (worker_id, status, period_end);

-- Solo el backend (service key) lee y escribe.
alter table public.worker_memberships enable row level security;
