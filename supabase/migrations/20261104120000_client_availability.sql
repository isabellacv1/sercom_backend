-- Horarios en que el cliente puede recibir al profesional:
-- [{ "date": "2026-11-05", "from": "07:00", "to": "12:00" }, ...]
-- El profesional elige uno de ellos al enviar su propuesta.
alter table public.services add column if not exists availability jsonb;
