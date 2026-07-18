BEGIN;

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS fifo_resolution text,
  ADD COLUMN IF NOT EXISTS fifo_unit_cost numeric(14, 4);

ALTER TABLE public.stock_adjustments
  DROP CONSTRAINT IF EXISTS stock_adjustments_fifo_resolution_check;

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_fifo_resolution_check
  CHECK (fifo_resolution IS NULL OR fifo_resolution IN ('opening_balance', 'dated_increase', 'dated_decrease', 'ignored'));

UPDATE public.stock_adjustments
SET fifo_resolution = 'opening_balance',
    fifo_unit_cost = CASE upper(trim(product_code))
      WHEN 'A301' THEN 1390
      WHEN 'A303' THEN 1260
      WHEN 'A509' THEN 505
      WHEN 'A603' THEN 500
      WHEN 'C014' THEN 582
      WHEN 'F004' THEN 450
    END
WHERE created_at::date = DATE '2026-07-09'
  AND upper(trim(product_code)) IN ('A301', 'A303', 'A509', 'A603', 'C014', 'F004')
  AND adjustment_qty > 0;

DO $migration$
DECLARE
  resolved_count integer;
BEGIN
  SELECT count(*) INTO resolved_count
  FROM public.stock_adjustments
  WHERE created_at::date = DATE '2026-07-09'
    AND upper(trim(product_code)) IN ('A301', 'A303', 'A509', 'A603', 'C014', 'F004')
    AND fifo_resolution = 'opening_balance'
    AND fifo_unit_cost > 0;

  IF resolved_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 resolved opening adjustments, found %', resolved_count;
  END IF;
END
$migration$;

INSERT INTO public.fifo_opening_balances (product_code, quantity, unit_cost, source_note)
VALUES
  ('A301', 21, 1390, 'User confirmed 2026-07-18; resolves 2026-07-09 opening-stock correction'),
  ('A303', 11, 1260, 'User confirmed 2026-07-18; resolves 2026-07-09 opening-stock correction'),
  ('A509',  5,  505, 'User confirmed 2026-07-18; resolves 2026-07-09 opening-stock correction'),
  ('A603',  4,  500, 'User confirmed 2026-07-18; resolves 2026-07-09 opening-stock correction'),
  ('C014',  7,  582, 'User confirmed 2026-07-18; resolves 2026-07-09 opening-stock correction'),
  ('F004', 62,  450, 'User confirmed 2026-07-18; resolves two 2026-07-09 opening-stock corrections')
ON CONFLICT (product_code) DO UPDATE
SET quantity = EXCLUDED.quantity,
    unit_cost = EXCLUDED.unit_cost,
    source_note = EXCLUDED.source_note,
    updated_at = now();

COMMIT;
