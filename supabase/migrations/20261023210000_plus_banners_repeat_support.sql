-- SERCOM Plus (clientes), banners, repetir/recurrentes y soporte.
-- Solo agrega columnas y tablas nuevas.

-- ── Repetir con el mismo profesional ──────────────────────────────────────
-- La solicitud nueva queda reservada para ese profesional un tiempo.
alter table public.services
  add column if not exists preferred_worker_id uuid references public.profiles(id),
  add column if not exists reserved_until      timestamptz,
  add column if not exists repeated_from       uuid references public.services(id),
  add column if not exists recurrence_id       uuid;

create table if not exists public.service_recurrences (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.profiles(id) on delete cascade,
  source_service_id uuid not null references public.services(id) on delete cascade,
  worker_id         uuid references public.profiles(id),
  interval_days     integer not null check (interval_days between 7 and 90),
  next_run_at       timestamptz not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists service_recurrences_due_idx
  on public.service_recurrences (active, next_run_at);
alter table public.service_recurrences enable row level security;

-- ── Banners de promociones ────────────────────────────────────────────────
create table if not exists public.promo_banners (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  subtitle     text,
  cta_label    text not null,
  action_type  text not null check (action_type in ('coupon', 'plus', 'pro', 'category', 'url', 'referral')),
  action_value text,
  audience     text not null default 'client' check (audience in ('client', 'worker', 'all')),
  icon         text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  sort_order   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table public.promo_banners enable row level security;

insert into public.promo_banners (title, subtitle, cta_label, action_type, action_value, icon, ends_at, sort_order)
select 'Temporada de lluvias', 'Revisa techos y canales: 10% de descuento con LLUVIAS.', 'Usar cupón LLUVIAS', 'coupon', 'LLUVIAS', 'water_drop', '2026-12-31T23:59:59-05:00', 1
where not exists (select 1 from public.promo_banners where action_value = 'LLUVIAS');

insert into public.promo_banners (title, subtitle, cta_label, action_type, icon, sort_order)
select 'SERCOM Plus', 'Sin tarifa de servicio, atención prioritaria y garantía de 30 días.', 'Conocer Plus', 'plus', 'workspace_premium', 2
where not exists (select 1 from public.promo_banners where action_type = 'plus');

insert into public.promo_banners (title, subtitle, cta_label, action_type, icon, ends_at, sort_order)
select 'Prepara tu casa para diciembre', 'Pintura, aseo profundo y arreglos antes de las fiestas.', 'Pedir un servicio', 'url', 'celebration', '2026-12-24T23:59:59-05:00', 3
where not exists (select 1 from public.promo_banners where title = 'Prepara tu casa para diciembre');

insert into public.promo_banners (title, subtitle, cta_label, action_type, icon, sort_order)
select 'Invita y gana $10.000', 'Por cada amigo que pida su primer servicio, ganan los dos.', 'Invitar amigos', 'referral', 'card_giftcard', 4
where not exists (select 1 from public.promo_banners where action_type = 'referral');

-- ── Soporte: reportar un problema ─────────────────────────────────────────
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity,
  service_id  uuid references public.services(id) on delete set null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  user_role   text not null check (user_role in ('client', 'worker')),
  category    text not null check (category in ('no_show', 'quality', 'damage', 'payment', 'safety', 'other')),
  description text not null,
  status      text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  priority    text not null default 'normal' check (priority in ('normal', 'high')),
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id);
alter table public.support_tickets enable row level security;
