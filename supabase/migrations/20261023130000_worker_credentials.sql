-- Formación y certificados reales de los profesionales (SENA, universidad,
-- CONTE, etc.). Reemplaza los cursos internos de la app, que no tenían validez.
-- Solo agrega objetos nuevos; las tablas de certificaciones anteriores quedan
-- sin uso (no se borran).

create table if not exists public.worker_credentials (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  institution text not null,
  issued_at   date,
  expires_at  date,
  file_path   text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'verified', 'rejected')),
  review_note text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists worker_credentials_worker_id_idx
  on public.worker_credentials (worker_id);

-- Solo el backend (service key) lee y escribe.
alter table public.worker_credentials enable row level security;

-- Bucket privado: los certificados suelen incluir cédula y datos personales.
insert into storage.buckets (id, name, public)
values ('worker-credentials', 'worker-credentials', false)
on conflict (id) do nothing;
