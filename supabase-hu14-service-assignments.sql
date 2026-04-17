alter table public.service_assignments
add column if not exists service_description text,
add column if not exists estimated_time_minutes integer;

update public.service_assignments
set
  service_description = coalesce(service_description, 'Propuesta sin descripcion'),
  estimated_time_minutes = coalesce(estimated_time_minutes, 60);

alter table public.service_assignments
alter column service_description set not null,
alter column estimated_time_minutes set not null;

alter table public.service_assignments
add constraint service_assignments_estimated_time_minutes_check
check (estimated_time_minutes > 0);
