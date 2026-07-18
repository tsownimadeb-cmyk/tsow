BEGIN;

CREATE TABLE IF NOT EXISTS public.fifo_opening_balances (
  product_code text PRIMARY KEY REFERENCES public.products(code) ON UPDATE CASCADE ON DELETE CASCADE,
  quantity numeric(14, 2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost > 0),
  source_note text NOT NULL DEFAULT 'user-confirmed opening FIFO balance',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fifo_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users only" ON public.fifo_opening_balances;
CREATE POLICY "Authenticated users only"
  ON public.fifo_opening_balances
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.fifo_opening_balances FROM PUBLIC, anon;
GRANT ALL ON TABLE public.fifo_opening_balances TO authenticated, service_role;

INSERT INTO public.fifo_opening_balances (product_code, quantity, unit_cost, source_note)
VALUES
  ('A502',   169, 490, 'User confirmed on 2026-07-18'),
  ('A502-2',   8, 490, 'User confirmed on 2026-07-18'),
  ('A504',    10, 576, 'User confirmed on 2026-07-18'),
  ('A506',     8, 576, 'User confirmed on 2026-07-18'),
  ('A507',   105, 576, 'User confirmed on 2026-07-18'),
  ('D000',    36, 471, 'User confirmed on 2026-07-18')
ON CONFLICT (product_code) DO UPDATE
SET quantity = EXCLUDED.quantity,
    unit_cost = EXCLUDED.unit_cost,
    source_note = EXCLUDED.source_note,
    updated_at = now();

COMMIT;

