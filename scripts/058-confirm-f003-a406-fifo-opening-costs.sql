BEGIN;

-- User-confirmed FIFO opening costs on 2026-08-16.
-- Quantities were reconciled from the live stock and transaction ledger:
-- F003: 52 current + 1,795 sold - 1,828 purchased = 19 opening units.
-- A406:  1 current +   239 sold -   239 purchased =  1 opening unit.
INSERT INTO public.fifo_opening_balances (
  product_code,
  quantity,
  unit_cost,
  source_note,
  updated_at
)
VALUES
  ('F003', 19,  390, 'User confirmed FIFO opening cost on 2026-08-16'),
  ('A406',  1, 1500, 'User confirmed FIFO opening cost on 2026-08-16')
ON CONFLICT (product_code) DO UPDATE
SET quantity = EXCLUDED.quantity,
    unit_cost = EXCLUDED.unit_cost,
    source_note = EXCLUDED.source_note,
    updated_at = now();

DO $migration$
DECLARE
  mismatch_count integer;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM (
    VALUES
      ('F003'::text, 19::numeric,  390::numeric),
      ('A406'::text,  1::numeric, 1500::numeric)
  ) AS expected(product_code, quantity, unit_cost)
  LEFT JOIN public.fifo_opening_balances actual
    ON actual.product_code = expected.product_code
  WHERE actual.product_code IS NULL
     OR actual.quantity <> expected.quantity
     OR actual.unit_cost <> expected.unit_cost;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'F003/A406 FIFO opening balance verification failed for % rows', mismatch_count;
  END IF;
END
$migration$;

COMMIT;
