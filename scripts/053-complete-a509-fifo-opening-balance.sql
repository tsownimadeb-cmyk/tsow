BEGIN;

-- A509 had six units sold on 2026-02-13 before the first recorded purchase.
-- The user confirmed this was an opening-stock quantity gap and confirmed the
-- historical unit cost as 505. Add it only to the FIFO opening layer; do not
-- change the product's current on-hand quantity.
INSERT INTO public.fifo_opening_balances (product_code, quantity, unit_cost, source_note)
VALUES (
  'A509',
  11,
  505,
  'User confirmed 2026-07-18; 5 units from stock correction plus 6 missing opening units before 2026-02-13 sale'
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
  WHERE upper(trim(product_code)) = 'A509';

  IF confirmed_quantity <> 11 OR confirmed_cost <> 505 THEN
    RAISE EXCEPTION 'A509 FIFO opening balance verification failed: quantity %, cost %',
      confirmed_quantity, confirmed_cost;
  END IF;
END
$migration$;

COMMIT;
