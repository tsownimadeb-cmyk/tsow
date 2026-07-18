BEGIN;

CREATE TABLE IF NOT EXISTS public.fifo_purchase_cost_overrides (
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.products(code) ON UPDATE CASCADE ON DELETE CASCADE,
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost > 0),
  source_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (purchase_order_id, product_code)
);

ALTER TABLE public.fifo_purchase_cost_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users only" ON public.fifo_purchase_cost_overrides;
CREATE POLICY "Authenticated users only"
  ON public.fifo_purchase_cost_overrides
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.fifo_purchase_cost_overrides FROM PUBLIC, anon;
GRANT ALL ON TABLE public.fifo_purchase_cost_overrides TO authenticated, service_role;

CREATE TEMP TABLE fifo_purchase_cost_corrections_055 (
  purchase_order_id uuid NOT NULL,
  product_code text NOT NULL,
  unit_cost numeric(14, 4) NOT NULL,
  PRIMARY KEY (purchase_order_id, product_code)
) ON COMMIT DROP;

INSERT INTO fifo_purchase_cost_corrections_055 (purchase_order_id, product_code, unit_cost)
VALUES
  ('02fb8d5a-ac34-4865-b1de-53f3b4da0eef', 'A707',   47.36),
  ('ca596738-84f8-40dd-93ed-21a0c9b81e22', 'A707',   47.36),
  ('edaf57d6-a456-476c-a3d5-5c4c75300619', 'A707',   47.36),
  ('80388140-f665-4e2b-b6e1-0636118be765', 'D000',  471.00),
  ('d3c8f424-2e45-4af5-94ba-9dcdfe1c180c', 'D000',  471.00),
  ('78f02e06-862e-481e-b5ba-f135cf891e64', 'D000',  471.00),
  ('9553cfed-0d7d-4b25-8ce7-5b0421dbb685', 'D000',  471.00),
  ('df1771c7-242d-4a57-9eca-706ae15e3a3c', 'D000',  471.00),
  ('ac6d11f7-f57d-4175-9e94-72f74dc7de62', 'D000-1',471.00),
  ('5b77551e-a9e9-4f20-9776-f956a7e4bef1', 'G006',  660.00),
  ('a083ee7f-2fdd-4dfa-880f-18d9c0a11d41', 'G006',  660.00),
  ('cdd68921-9cd0-4a84-b7ff-d82c9e7cc404', 'G007',  770.00),
  ('a083ee7f-2fdd-4dfa-880f-18d9c0a11d41', 'G007',  770.00),
  ('f015275b-cb43-4a35-98b0-ce1212a58f24', 'G008', 1100.00),
  ('5b77551e-a9e9-4f20-9776-f956a7e4bef1', 'G008', 1100.00),
  ('cdd68921-9cd0-4a84-b7ff-d82c9e7cc404', 'G008', 1100.00),
  ('a083ee7f-2fdd-4dfa-880f-18d9c0a11d41', 'G008', 1100.00);

INSERT INTO public.fifo_purchase_cost_overrides (
  purchase_order_id,
  product_code,
  unit_cost,
  source_note
)
SELECT
  purchase_order_id,
  product_code,
  unit_cost,
  'User confirmed 2026-07-18; zero-cost historical purchase valued from earliest completed purchase landed cost'
FROM fifo_purchase_cost_corrections_055
ON CONFLICT (purchase_order_id, product_code) DO UPDATE
SET unit_cost = EXCLUDED.unit_cost,
    source_note = EXCLUDED.source_note,
    updated_at = now();

DO $migration$
DECLARE
  expected_count integer;
  mismatch_count integer;
BEGIN
  SELECT count(*) INTO expected_count FROM fifo_purchase_cost_corrections_055;
  IF expected_count <> 17 THEN
    RAISE EXCEPTION 'Expected 17 FIFO purchase cost corrections, found %', expected_count;
  END IF;

  SELECT count(*)
  INTO mismatch_count
  FROM fifo_purchase_cost_corrections_055 expected
  LEFT JOIN public.fifo_purchase_cost_overrides actual
    ON actual.purchase_order_id = expected.purchase_order_id
   AND actual.product_code = expected.product_code
  WHERE actual.purchase_order_id IS NULL
     OR actual.unit_cost <> expected.unit_cost;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'FIFO purchase cost correction verification failed for % rows', mismatch_count;
  END IF;
END
$migration$;

COMMIT;
