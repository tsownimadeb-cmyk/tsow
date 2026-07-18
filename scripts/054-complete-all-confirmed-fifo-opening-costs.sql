BEGIN;

-- The user confirmed on 2026-07-18 that historical FIFO quantity gaps should
-- be treated as stock that existed before the recorded transaction history.
-- Costs use the earliest completed purchase's landed unit cost, except A506,
-- whose previously confirmed opening cost remains 576.
CREATE TEMP TABLE fifo_opening_corrections_054 (
  product_code text PRIMARY KEY,
  quantity numeric(14, 2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost > 0)
) ON COMMIT DROP;

INSERT INTO fifo_opening_corrections_054 (product_code, quantity, unit_cost)
VALUES
  ('A101',      1,  405.90),
  ('A102',      2,  405.90),
  ('A103',      1,  405.90),
  ('A110',      7,  999.90),
  ('A111',      3,  999.90),
  ('A112',      1,  999.90),
  ('A113',     15,  999.90),
  ('A118',      8,  999.90),
  ('A307',      1, 1220.00),
  ('A407',      1, 1395.00),
  ('A501',      8,  490.00),
  ('A503',     20,  475.00),
  ('A505',     48,  570.00),
  ('A506',     97,  576.00),
  ('A506-6',   10,  570.00),
  ('A512',     24,  610.00),
  ('A519',     89,  580.00),
  ('A520',     27,  670.00),
  ('A702',    498,   64.58),
  ('A703',    226,   92.00),
  ('A704',    435,   90.00),
  ('A705',    504,  129.17),
  ('A706',    250,   62.50),
  ('A707',   5249,   47.36),
  ('C001',      5,  456.00),
  ('C012',      1, 1380.00),
  ('C013',     10,  582.00),
  ('C014',     20,  582.00),
  ('D000',    836,  471.00),
  ('D000-1',   20,  471.00),
  ('D000-2',   10,  314.00),
  ('D003',     10,  204.00),
  ('D003-2',    1,  316.50),
  ('D004-2',   28,  369.00),
  ('D005-2',    1,  182.00),
  ('D005-6',   18,  276.00),
  ('D006-2',   87,  357.00),
  ('D006-4',    6,  450.00),
  ('E005',     17,  700.00),
  ('E009',     53,  865.00),
  ('F001',    101,  400.00),
  ('F005',    284,  250.00),
  ('F007',     43,  420.00),
  ('F008',    352,  390.00),
  ('F012',    215,  390.00),
  ('G002',      9,  260.00),
  ('G006',      6,  660.00),
  ('G007',      1,  770.00),
  ('G008',      5, 1100.00),
  ('H000',     16,  350.00),
  ('H001',     23,  330.00),
  ('H006',      1,  360.00);

DO $migration$
DECLARE
  expected_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM fifo_opening_corrections_054;
  IF expected_count <> 52 THEN
    RAISE EXCEPTION 'Expected 52 FIFO opening corrections, found %', expected_count;
  END IF;
END
$migration$;

INSERT INTO public.fifo_opening_balances (product_code, quantity, unit_cost, source_note)
SELECT
  product_code,
  quantity,
  unit_cost,
  CASE
    WHEN product_code = 'A506'
      THEN 'User confirmed 2026-07-18; historical FIFO gap at previously confirmed A506 opening cost'
    ELSE 'User confirmed 2026-07-18; historical FIFO gap valued from earliest completed purchase landed cost'
  END
FROM fifo_opening_corrections_054
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
  FROM fifo_opening_corrections_054 expected
  LEFT JOIN public.fifo_opening_balances actual
    ON upper(trim(actual.product_code)) = expected.product_code
  WHERE actual.product_code IS NULL
     OR actual.quantity <> expected.quantity
     OR actual.unit_cost <> expected.unit_cost;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'FIFO opening correction verification failed for % products', mismatch_count;
  END IF;
END
$migration$;

COMMIT;
