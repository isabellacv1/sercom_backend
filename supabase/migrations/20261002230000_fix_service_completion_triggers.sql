-- ============================================================================
-- Corrige el cierre de servicios (confirmación mutua cliente + trabajador).
--
-- Problema: al confirmar ambas partes, UPDATE services fallaba con
--   ERROR: column "balance" does not exist
-- por el trigger heredado `trigger_liberar_pago`, que además sumaba
-- `budget_max` (presupuesto del cliente, no el precio acordado) a una columna
-- inexistente `profiles.balance`.
--
-- Además, `finalize_service_escrow` marcaba el pago como 'released' dentro del
-- mismo UPDATE (incluso pagos 'pending' nunca cobrados). Eso impedía que el
-- backend (PaymentsService.disburseWorkerPayment, que busca status='held')
-- ejecutara el desembolso, la auditoría y la notificación al trabajador.
--
-- Solución:
--   1. Eliminar el trigger/función heredados `liberar_pago_servicio`.
--   2. `finalize_service_escrow` solo completa el servicio y registra el
--      historial; el ciclo de vida del pago lo gestiona el backend.
--
-- Aplicar con:  supabase db query --linked -f <este archivo>
--          o pegando el contenido en el SQL Editor de Supabase.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_liberar_pago ON public.services;
DROP FUNCTION IF EXISTS public.liberar_pago_servicio();

CREATE OR REPLACE FUNCTION public.finalize_service_escrow()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.worker_confirmation = true
       AND NEW.client_confirmation = true
       AND OLD.status != 'completed' THEN

        NEW.status = 'completed';
        NEW.completed_at = NOW();

        INSERT INTO public.service_status_history (service_id, status, changed_by, note)
        VALUES (
            NEW.id,
            'completed',
            NEW.client_id,
            'Servicio finalizado por confirmación mutua.'
        );
    END IF;

    RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- ROLLBACK (definiciones originales, por si hiciera falta revertir):
--
-- CREATE OR REPLACE FUNCTION public.liberar_pago_servicio() RETURNS trigger
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   IF NEW.client_confirmation = true AND NEW.worker_confirmation = true THEN
--     UPDATE profiles SET balance = COALESCE(balance, 0) + COALESCE(NEW.budget_max, 0)
--     WHERE id = NEW.assigned_worker_id;
--     UPDATE payments SET status = 'released' WHERE service_id = NEW.id;
--   END IF;
--   RETURN NEW;
-- END; $$;
-- CREATE TRIGGER trigger_liberar_pago AFTER UPDATE ON public.services
--   FOR EACH ROW EXECUTE FUNCTION liberar_pago_servicio();
--
-- (finalize_service_escrow original además ejecutaba:
--   UPDATE public.payments SET status = 'released', released_at = NOW(),
--     updated_at = NOW()
--   WHERE service_id = NEW.id AND status IN ('held', 'escrow', 'pending');)
-- ----------------------------------------------------------------------------
