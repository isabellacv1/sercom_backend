-- Garantía extendida (90 días) y registro de cotizaciones con foto (IA).
-- Solo agrega columnas y una tabla nueva.

alter table public.payments
  add column if not exists warranty_amount numeric not null default 0,
  add column if not exists warranty_days   integer not null default 0;

create table if not exists public.photo_quotes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  category    text,
  service     text,
  price_min   numeric,
  price_max   numeric,
  urgent      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists photo_quotes_user_idx on public.photo_quotes (user_id, created_at);
alter table public.photo_quotes enable row level security;
