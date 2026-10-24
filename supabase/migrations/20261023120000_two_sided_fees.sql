-- Comisión a ambos lados: se guarda el desglose de cada pago.
--   service_price             precio del servicio (propuesta del técnico)
--   client_fee_amount         tarifa de servicio que paga el cliente (se suma)
--   worker_commission_amount  comisión que se descuenta al técnico
-- amount_total / commission_amount / worker_amount siguen como antes:
-- lo que paga el cliente, ingreso total de SerCom y neto del técnico.
-- Solo agrega columnas; los pagos existentes se rellenan con su modelo previo
-- (comisión solo al técnico).

alter table public.payments
  add column if not exists service_price            numeric,
  add column if not exists client_fee_amount        numeric not null default 0,
  add column if not exists worker_commission_amount numeric;

update public.payments
set service_price = amount_total,
    worker_commission_amount = commission_amount
where service_price is null;
