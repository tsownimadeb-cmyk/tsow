-- Correct the user-confirmed physical counts from the 2026-07-26 audit.
-- Each increase is recorded as a dated FIFO batch at the product's current
-- landed cost. This does not change historical sales, purchases, AR, or AP.
BEGIN;

CREATE TEMP TABLE inventory_corrections_056 (
  product_code text PRIMARY KEY,
  expected_old_stock numeric NOT NULL,
  target_new_stock numeric NOT NULL,
  fifo_unit_cost numeric NOT NULL
) ON COMMIT DROP;

INSERT INTO inventory_corrections_056 (
  product_code,
  expected_old_stock,
  target_new_stock,
  fifo_unit_cost
)
VALUES
  ('H006', 30,  37,  360),
  ('A301', 59,  77, 1390),
  ('A405',  6,   7, 1545),
  ('A706', 315, 353, 67.5),
  ('C014',  5,  10,  582),
  ('F006', 23,  40, 1030),
  ('F007', 91, 117,  435);

DO $$
DECLARE
  mismatch_details text;
  existing_correction_count integer;
BEGIN
  PERFORM 1
  FROM public.products p
  JOIN inventory_corrections_056 c ON c.product_code = p.code
  ORDER BY p.code
  FOR UPDATE OF p;

  SELECT string_agg(
    format(
      '%s expected %s but found %s',
      c.product_code,
      c.expected_old_stock,
      COALESCE(p.stock_qty, 0)
    ),
    '; '
  )
  INTO mismatch_details
  FROM inventory_corrections_056 c
  LEFT JOIN public.products p ON p.code = c.product_code
  WHERE p.code IS NULL
     OR COALESCE(p.stock_qty, 0) <> c.expected_old_stock;

  IF mismatch_details IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory correction aborted: %', mismatch_details;
  END IF;

  SELECT count(*)
  INTO existing_correction_count
  FROM public.stock_adjustments
  WHERE adjusted_by = 'inventory_correction_2026_07_26'
    AND product_code IN (SELECT product_code FROM inventory_corrections_056);

  IF existing_correction_count > 0 THEN
    RAISE EXCEPTION 'Inventory correction was already recorded for % rows', existing_correction_count;
  END IF;
END;
$$;

INSERT INTO public.stock_adjustments (
  product_code,
  old_stock,
  new_stock,
  adjustment_qty,
  reason,
  adjusted_by,
  created_at,
  fifo_resolution,
  fifo_unit_cost
)
SELECT
  product_code,
  expected_old_stock,
  target_new_stock,
  target_new_stock - expected_old_stock,
  '2026-07-26 physical inventory recount: restore system shortage',
  'inventory_correction_2026_07_26',
  now(),
  'dated_increase',
  fifo_unit_cost
FROM inventory_corrections_056;

UPDATE public.products p
SET
  stock_qty = c.target_new_stock,
  updated_at = now()
FROM inventory_corrections_056 c
WHERE p.code = c.product_code;

DO $$
DECLARE
  mismatch_count integer;
  adjustment_count integer;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM inventory_corrections_056 c
  JOIN public.products p ON p.code = c.product_code
  WHERE COALESCE(p.stock_qty, 0) <> c.target_new_stock;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Inventory correction verification failed for % products', mismatch_count;
  END IF;

  SELECT count(*)
  INTO adjustment_count
  FROM public.stock_adjustments
  WHERE adjusted_by = 'inventory_correction_2026_07_26'
    AND product_code IN (SELECT product_code FROM inventory_corrections_056);

  IF adjustment_count <> 7 THEN
    RAISE EXCEPTION 'Expected 7 stock adjustment rows, found %', adjustment_count;
  END IF;
END;
$$;

COMMIT;
