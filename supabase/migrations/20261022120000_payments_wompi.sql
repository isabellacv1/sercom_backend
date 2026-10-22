-- Pagos con Wompi (Bancolombia): columnas genéricas de proveedor.
-- Solo agrega columnas; no modifica ni borra datos existentes.

alter table public.payments
  add column if not exists checkout_reference      text,
  add column if not exists provider_transaction_id text,
  add column if not exists provider_status         text,
  add column if not exists provider_status_detail  text,
  add column if not exists provider_payment_method text,
  add column if not exists refund_reference        text;

create index if not exists payments_checkout_reference_idx
  on public.payments (checkout_reference);

create index if not exists payments_provider_transaction_id_idx
  on public.payments (provider_transaction_id);

-- Si existían CHECKs que restringían provider / payment_method a valores de
-- Mercado Pago, se eliminan para aceptar 'wompi' / 'wompi_checkout'.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'payments'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%mercadopago%'
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end $$;
