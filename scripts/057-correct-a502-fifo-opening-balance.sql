BEGIN;

-- Reconciled on 2026-08-16 from the live movement ledger:
-- current stock 89 + active sales 6,246 - completed purchases 6,078 = 257.
-- There are no sales returns, purchase returns, or stock adjustments for A502.
INSERT INTO public.fifo_opening_balances (
  product_code,
  quantity,
  unit_cost,
  source_note,
  updated_at
)
VALUES (
  'A502',
  257,
  490,
  'Reconciled from live stock and transaction history on 2026-08-16; user requested A502 FIFO resolution',
  now()
)
ON CONFLICT (product_code) DO UPDATE
SET quantity = EXCLUDED.quantity,
    unit_cost = EXCLUDED.unit_cost,
    source_note = EXCLUDED.source_note,
    updated_at = now();

DO $migration$
DECLARE
  confirmed_quantity numeric;
  confirmed_cost numeric;
BEGIN
  SELECT quantity, unit_cost
  INTO confirmed_quantity, confirmed_cost
  FROM public.fifo_opening_balances
  WHERE product_code = 'A502';

  IF confirmed_quantity <> 257 OR confirmed_cost <> 490 THEN
    RAISE EXCEPTION 'A502 FIFO opening balance verification failed: quantity %, cost %',
      confirmed_quantity,
      confirmed_cost;
  END IF;
END
$migration$;

COMMIT;
