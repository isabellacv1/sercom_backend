-- ============================================================================
-- Cierra la exposición de datos por la clave pública (anon).
--
-- Diagnóstico (2026-10-02): las políticas RLS existen pero RLS estaba
-- DESACTIVADO en profiles, services, payments, proposals y reviews, por lo que
-- cualquiera con la anon key (incrustada en la app) podía leer correos,
-- teléfonos, direcciones, números de cédula y URLs de documentos, todos los
-- pagos y propuestas, e incluso insertar reseñas. `chat_rooms` además tenía
-- políticas "allow all" para el rol público (leer/crear/modificar salas).
--
-- Seguridad del cambio:
--   - El backend usa la service key → no le afecta RLS.
--   - La app ya no consulta estas tablas directamente: usa el backend
--     (/profiles/:id/public, /services/:id/tracking, /reviews/worker-review…).
--   ⚠ Aplicar DESPUÉS de publicar esa versión de la app; versiones anteriores
--     que leen Supabase directo dejarán de ver esos datos.
--
-- Aplicar con:  supabase db query --linked -f <este archivo>
--          o en el SQL Editor de Supabase.
-- Revertir:     ALTER TABLE ... DISABLE ROW LEVEL SECURITY; (no recomendado)
-- ============================================================================

ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews   ENABLE ROW LEVEL SECURITY;

-- Las políticas existentes (dueño / participante con auth.uid()) quedan
-- vigentes. Se eliminan las que abrían las salas de chat a cualquiera.
DROP POLICY IF EXISTS "allow all select"        ON public.chat_rooms;
DROP POLICY IF EXISTS "allow all insert"        ON public.chat_rooms;
DROP POLICY IF EXISTS "allow all update"        ON public.chat_rooms;
DROP POLICY IF EXISTS "Allow select chat rooms" ON public.chat_rooms;
DROP POLICY IF EXISTS "Allow insert chat rooms" ON public.chat_rooms;

-- "Servicios son visibles si son propios o están activos" aplica al rol
-- público: con RLS activo, un anónimo vería servicios 'requested' (con
-- dirección). Las oportunidades se sirven por el backend, así que se limita a
-- usuarios autenticados.
DROP POLICY IF EXISTS "Servicios son visibles si son propios o están activos" ON public.services;
CREATE POLICY "Autenticados ven servicios propios o solicitados"
  ON public.services FOR SELECT TO authenticated
  USING (auth.uid() = client_id OR status = 'requested'::service_status);
