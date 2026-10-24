-- Cobro inmediato, tarifa dinámica, tarjetas de regalo, SERCOM Ads y plan
-- de mantenimiento. Solo agrega columnas y tablas nuevas.

-- ── Tarifa dinámica ───────────────────────────────────────────────────────
alter table public.services
  add column if not exists is_urgent boolean not null default false;

alter table public.payments
  add column if not exists surcharge_amount  numeric not null default 0,
  add column if not exists surcharge_reasons text[];

-- ── Cobro inmediato ───────────────────────────────────────────────────────
alter table public.payments
  add column if not exists payout_priority text check (payout_priority in ('standard', 'instant')),
  add column if not exists payout_fee      numeric not null default 0;

alter table public.service_tips
  add column if not exists payout_priority text check (payout_priority in ('standard', 'instant')),
  add column if not exists payout_fee      numeric not null default 0;

-- ── Tarjetas de regalo ────────────────────────────────────────────────────
create table if not exists public.gift_cards (
  id                      uuid primary key default gen_random_uuid(),
  buyer_id                uuid not null references public.profiles(id) on delete cascade,
  amount                  numeric not null check (amount > 0),
  code                    text unique,
  recipient_name          text,
  message                 text,
  status                  text not null default 'pending'
                          check (status in ('pending', 'paid', 'redeemed', 'failed')),
  redeemed_by             uuid references public.profiles(id),
  redeemed_at             timestamptz,
  checkout_reference      text,
  provider_transaction_id text,
  provider_status         text,
  paid_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists gift_cards_buyer_idx on public.gift_cards (buyer_id);
alter table public.gift_cards enable row level security;

-- ── SERCOM Ads: profesionales destacados ──────────────────────────────────
create table if not exists public.worker_boosts (
  id                      uuid primary key default gen_random_uuid(),
  worker_id               uuid not null references public.profiles(id) on delete cascade,
  days                    integer not null check (days > 0),
  amount                  numeric not null,
  status                  text not null default 'pending'
                          check (status in ('pending', 'active', 'failed')),
  period_start            timestamptz,
  period_end              timestamptz,
  checkout_reference      text,
  provider_transaction_id text,
  provider_status         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists worker_boosts_active_idx on public.worker_boosts (worker_id, status, period_end);
alter table public.worker_boosts enable row level security;
