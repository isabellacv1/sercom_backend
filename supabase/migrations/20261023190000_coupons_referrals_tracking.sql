-- Cupones, referidos con saldo SERCOM y seguimiento en mapa.
-- Solo agrega columnas y tablas nuevas.

-- ── Descuentos aplicados a un pago ─────────────────────────────────────────
-- amount_total pasa a ser lo que se cobra tras descuentos; el técnico no se
-- ve afectado (el descuento sale de la comisión de SerCom).
alter table public.payments
  add column if not exists amount_before_discount     numeric,
  add column if not exists commission_before_discount numeric,
  add column if not exists coupon_code                text,
  add column if not exists coupon_discount            numeric not null default 0,
  add column if not exists credit_applied             numeric not null default 0;

-- ── Cupones ───────────────────────────────────────────────────────────────
create table if not exists public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  description        text,
  discount_type      text not null check (discount_type in ('percent', 'fixed')),
  discount_value     numeric not null check (discount_value > 0),
  max_discount       numeric,
  min_amount         numeric not null default 0,
  first_service_only boolean not null default false,
  category_id        uuid references public.service_categories(id),
  starts_at          timestamptz,
  ends_at            timestamptz,
  max_redemptions    integer,
  max_per_user       integer not null default 1,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
alter table public.coupons enable row level security;

-- Cupones de lanzamiento.
insert into public.coupons (code, description, discount_type, discount_value, max_discount, first_service_only)
values ('BIENVENIDO', '20% en tu primer servicio', 'percent', 20, 30000, true)
on conflict (code) do nothing;
insert into public.coupons (code, description, discount_type, discount_value, max_discount, ends_at)
values ('LLUVIAS', '10% para preparar tu casa para la temporada de lluvias', 'percent', 10, 20000, '2026-12-31T23:59:59-05:00')
on conflict (code) do nothing;

-- ── Saldo SERCOM (movimientos: + crédito, − uso) ──────────────────────────
create table if not exists public.user_credits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  amount       numeric not null,
  reason       text not null,
  reference_id text,
  created_at   timestamptz not null default now()
);
create index if not exists user_credits_user_idx on public.user_credits (user_id);
alter table public.user_credits enable row level security;

-- ── Referidos ─────────────────────────────────────────────────────────────
create table if not exists public.referral_codes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;

create table if not exists public.referrals (
  id            uuid primary key default gen_random_uuid(),
  referrer_id   uuid not null references public.profiles(id) on delete cascade,
  referred_id   uuid not null unique references public.profiles(id) on delete cascade,
  code          text not null,
  referred_role text not null check (referred_role in ('client', 'worker')),
  status        text not null default 'pending' check (status in ('pending', 'rewarded')),
  rewarded_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;

-- ── Ubicación del técnico mientras va en camino ───────────────────────────
create table if not exists public.service_locations (
  service_id uuid primary key references public.services(id) on delete cascade,
  worker_id  uuid not null references public.profiles(id),
  latitude   double precision not null,
  longitude  double precision not null,
  accuracy   double precision,
  heading    double precision,
  updated_at timestamptz not null default now()
);
alter table public.service_locations enable row level security;
