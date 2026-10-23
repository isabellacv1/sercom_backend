-- Evidencia del trabajo realizado (fotos que sube el técnico antes de
-- marcar el servicio como finalizado).
--
-- En producción la tabla ya existía (vacía) con este esquema; el backend usa
-- file_url para la ruta en el bucket privado y description para el nombre.

create table if not exists public.service_evidence (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references public.services(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  file_url    text not null,
  description text,
  created_at  timestamptz not null default now()
);

create index if not exists service_evidence_service_id_idx
  on public.service_evidence (service_id);

-- Solo el backend (service key) lee y escribe; sin políticas para anon/auth.
alter table public.service_evidence enable row level security;

-- Bucket privado: las fotos se entregan con URLs firmadas temporales.
insert into storage.buckets (id, name, public)
values ('service-evidence', 'service-evidence', false)
on conflict (id) do nothing;
