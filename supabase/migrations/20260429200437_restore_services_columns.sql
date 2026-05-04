-- Restaurar estructura de public.services según types antiguos

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'service_status'
  ) THEN
    CREATE TYPE public.service_status AS ENUM (
      'requested',
      'assigned',
      'on_the_way',
      'in_progress',
      'completed',
      'cancelled',
      'draft'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'urgency_level'
  ) THEN
    CREATE TYPE public.urgency_level AS ENUM (
      'low',
      'medium',
      'high'
    );
  END IF;
END $$;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS assigned_worker_id uuid NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS budget_max integer NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS budget_min integer NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS city text NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS client_confirmation boolean NOT NULL DEFAULT false;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS latitude double precision NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS longitude double precision NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS service_option_id uuid NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS urgency_level public.urgency_level NULL;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS worker_confirmation boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_assigned_worker_id_fkey'
  ) THEN
    ALTER TABLE public.services
    ADD CONSTRAINT services_assigned_worker_id_fkey
    FOREIGN KEY (assigned_worker_id)
    REFERENCES public.profiles(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_category_id_fkey'
  ) THEN
    ALTER TABLE public.services
    ADD CONSTRAINT services_category_id_fkey
    FOREIGN KEY (category_id)
    REFERENCES public.service_categories(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_client_id_fkey'
  ) THEN
    ALTER TABLE public.services
    ADD CONSTRAINT services_client_id_fkey
    FOREIGN KEY (client_id)
    REFERENCES public.profiles(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_service_option_id_fkey'
  ) THEN
    ALTER TABLE public.services
    ADD CONSTRAINT services_service_option_id_fkey
    FOREIGN KEY (service_option_id)
    REFERENCES public.service_options(id);
  END IF;
END $$;