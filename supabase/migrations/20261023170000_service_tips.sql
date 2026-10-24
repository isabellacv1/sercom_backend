-- Propinas del cliente al profesional (100% para el profesional).
-- Solo agrega una tabla nueva.

create table if not exists public.service_tips (
  id                      uuid primary key default gen_random_uuid(),
  service_id              uuid not null references public.services(id) on delete cascade,
  client_id               uuid not null references public.profiles(id),
  worker_id               uuid references public.profiles(id),
  amount                  numeric not null check (amount > 0),
  status                  text not null default 'pending'
                          check (status in ('pending', 'paid', 'failed')),
  checkout_reference      text,
  provider_transaction_id text,
  provider_status         text,
  paid_at                 timestamptz,
  payout_status           text check (payout_status in ('pending_manual', 'completed')),
  external_transfer_id    text,
  disbursed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists service_tips_service_idx on public.service_tips (service_id);
create index if not exists service_tips_worker_idx on public.service_tips (worker_id, status);

-- Una sola propina pagada por servicio.
create unique index if not exists service_tips_one_paid_per_service
  on public.service_tips (service_id) where status = 'paid';

-- Solo el backend (service key) lee y escribe.
alter table public.service_tips enable row level security;
