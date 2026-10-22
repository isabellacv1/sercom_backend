-- Dónde recibe sus pagos cada profesional (Nequi, Daviplata o cuenta
-- bancaria). Solo agrega una tabla nueva.

create table if not exists public.worker_payout_accounts (
  worker_id       uuid primary key references public.profiles(id) on delete cascade,
  method          text not null check (method in ('nequi', 'daviplata', 'bank_account')),
  account_number  text not null,
  bank_name       text,
  account_type    text check (account_type in ('ahorros', 'corriente')),
  holder_name     text not null,
  holder_document text,
  updated_at      timestamptz not null default now()
);

-- Datos financieros: solo el backend (service key) los lee y escribe.
alter table public.worker_payout_accounts enable row level security;
