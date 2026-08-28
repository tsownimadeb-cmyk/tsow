-- Reconcile every FIFO opening quantity to the current physical stock and the
-- complete movement ledger. Existing costs are preserved; only quantities are
-- changed. A permanent before/after snapshot makes the correction reversible.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fifo_opening_balance_reconciliation_log (
  revision text NOT NULL,
  product_code text NOT NULL,
  old_quantity numeric(14, 2),
  old_unit_cost numeric(14, 4),
  old_source_note text,
  new_quantity numeric(14, 2),
  new_unit_cost numeric(14, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision, product_code)
);

ALTER TABLE public.fifo_opening_balance_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users only" ON public.fifo_opening_balance_reconciliation_log;
CREATE POLICY "Authenticated users only"
  ON public.fifo_opening_balance_reconciliation_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.fifo_opening_balance_reconciliation_log FROM PUBLIC, anon;
GRANT ALL ON TABLE public.fifo_opening_balance_reconciliation_log TO authenticated, service_role;

-- A101 has one fewer physical bag than its completed document ledger. Record
-- the already-reflected physical loss so its opening balance does not become -1.
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
  'A101',
  9,
  8,
  -1,
  '2026-08-28 FIFO reconciliation: physical stock is one bag below completed document ledger',
  'fifo_opening_reconciliation_2026_08_28',
  now(),
  'dated_decrease',
  405.9
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock_adjustments
  WHERE adjusted_by = 'fifo_opening_reconciliation_2026_08_28'
    AND upper(trim(product_code)) = 'A101'
);

CREATE TEMP TABLE fifo_opening_reconciled_059 (
  product_code text PRIMARY KEY,
  current_stock numeric NOT NULL,
  recorded_net_movement numeric NOT NULL,
  new_quantity numeric NOT NULL,
  unit_cost numeric(14, 4)
) ON COMMIT DROP;

WITH completed_purchases AS (
  SELECT upper(trim(poi.code)) AS product_code, sum(poi.quantity)::numeric AS quantity
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE lower(trim(po.status)) = 'completed'
  GROUP BY upper(trim(poi.code))
),
completed_sales AS (
  SELECT upper(trim(soi.code)) AS product_code, sum(soi.quantity)::numeric AS quantity
  FROM public.sales_order_items soi
  JOIN public.sales_orders so ON so.id = soi.sales_order_id
  WHERE lower(trim(so.status)) = 'completed'
  GROUP BY upper(trim(soi.code))
),
completed_purchase_returns AS (
  SELECT upper(trim(COALESCE(pri.product_code, pri.product_id::text))) AS product_code,
         sum(pri.quantity)::numeric AS quantity
  FROM public.purchase_return_items pri
  JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
  WHERE lower(trim(pr.status)) = 'completed'
  GROUP BY upper(trim(COALESCE(pri.product_code, pri.product_id::text)))
),
completed_sales_returns AS (
  SELECT upper(trim(COALESCE(sri.product_code, sri.product_id::text))) AS product_code,
         sum(sri.quantity)::numeric AS quantity
  FROM public.sales_return_items sri
  JOIN public.sales_returns sr ON sr.id = sri.sales_return_id
  WHERE lower(trim(sr.status)) = 'completed'
  GROUP BY upper(trim(COALESCE(sri.product_code, sri.product_id::text)))
),
dated_adjustments AS (
  SELECT upper(trim(sa.product_code)) AS product_code, sum(sa.adjustment_qty)::numeric AS quantity
  FROM public.stock_adjustments sa
  WHERE sa.fifo_resolution IN ('dated_increase', 'dated_decrease')
  GROUP BY upper(trim(sa.product_code))
),
movement AS (
  SELECT
    upper(trim(p.code)) AS product_code,
    COALESCE(p.stock_qty, 0)::numeric AS current_stock,
    COALESCE(cp.quantity, 0)
      - COALESCE(cs.quantity, 0)
      - COALESCE(cpr.quantity, 0)
      + COALESCE(csr.quantity, 0)
      + COALESCE(da.quantity, 0) AS recorded_net_movement
  FROM public.products p
  LEFT JOIN completed_purchases cp ON cp.product_code = upper(trim(p.code))
  LEFT JOIN completed_sales cs ON cs.product_code = upper(trim(p.code))
  LEFT JOIN completed_purchase_returns cpr ON cpr.product_code = upper(trim(p.code))
  LEFT JOIN completed_sales_returns csr ON csr.product_code = upper(trim(p.code))
  LEFT JOIN dated_adjustments da ON da.product_code = upper(trim(p.code))
)
INSERT INTO fifo_opening_reconciled_059 (
  product_code,
  current_stock,
  recorded_net_movement,
  new_quantity,
  unit_cost
)
SELECT
  movement.product_code,
  movement.current_stock,
  movement.recorded_net_movement,
  movement.current_stock - movement.recorded_net_movement,
  opening.unit_cost
FROM movement
LEFT JOIN public.fifo_opening_balances opening
  ON upper(trim(opening.product_code)) = movement.product_code;

DO $$
DECLARE
  negative_details text;
  missing_cost_details text;
  orphan_details text;
BEGIN
  SELECT string_agg(format('%s=%s', product_code, new_quantity), ', ' ORDER BY product_code)
  INTO negative_details
  FROM fifo_opening_reconciled_059
  WHERE new_quantity < 0;

  IF negative_details IS NOT NULL THEN
    RAISE EXCEPTION 'FIFO opening reconciliation produced negative quantities: %', negative_details;
  END IF;

  SELECT string_agg(product_code, ', ' ORDER BY product_code)
  INTO missing_cost_details
  FROM fifo_opening_reconciled_059
  WHERE new_quantity > 0
    AND COALESCE(unit_cost, 0) <= 0;

  IF missing_cost_details IS NOT NULL THEN
    RAISE EXCEPTION 'Positive FIFO openings are missing confirmed costs: %', missing_cost_details;
  END IF;

  SELECT string_agg(opening.product_code, ', ' ORDER BY opening.product_code)
  INTO orphan_details
  FROM public.fifo_opening_balances opening
  LEFT JOIN fifo_opening_reconciled_059 target
    ON target.product_code = upper(trim(opening.product_code))
  WHERE target.product_code IS NULL;

  IF orphan_details IS NOT NULL THEN
    RAISE EXCEPTION 'Orphan FIFO opening rows found: %', orphan_details;
  END IF;
END;
$$;

INSERT INTO public.fifo_opening_balance_reconciliation_log (
  revision,
  product_code,
  old_quantity,
  old_unit_cost,
  old_source_note,
  new_quantity,
  new_unit_cost
)
SELECT
  '2026-08-28-all-products',
  target.product_code,
  opening.quantity,
  opening.unit_cost,
  opening.source_note,
  NULLIF(target.new_quantity, 0),
  CASE WHEN target.new_quantity > 0 THEN target.unit_cost ELSE NULL END
FROM fifo_opening_reconciled_059 target
LEFT JOIN public.fifo_opening_balances opening
  ON upper(trim(opening.product_code)) = target.product_code
WHERE opening.product_code IS NOT NULL OR target.new_quantity > 0
ON CONFLICT (revision, product_code) DO NOTHING;

DELETE FROM public.fifo_opening_balances;

INSERT INTO public.fifo_opening_balances (
  product_code,
  quantity,
  unit_cost,
  source_note
)
SELECT
  product_code,
  new_quantity,
  unit_cost,
  'Reconciled 2026-08-28 to current stock and all completed inventory movements; previous values preserved in fifo_opening_balance_reconciliation_log'
FROM fifo_opening_reconciled_059
WHERE new_quantity > 0
ORDER BY product_code;

DO $$
DECLARE
  mismatch_details text;
  logged_count integer;
BEGIN
  SELECT string_agg(
    format('%s expected %s found %s', target.product_code, target.new_quantity, COALESCE(opening.quantity, 0)),
    '; ' ORDER BY target.product_code
  )
  INTO mismatch_details
  FROM fifo_opening_reconciled_059 target
  LEFT JOIN public.fifo_opening_balances opening
    ON upper(trim(opening.product_code)) = target.product_code
  WHERE COALESCE(opening.quantity, 0) <> target.new_quantity;

  IF mismatch_details IS NOT NULL THEN
    RAISE EXCEPTION 'FIFO opening write verification failed: %', mismatch_details;
  END IF;

  SELECT count(*) INTO logged_count
  FROM public.fifo_opening_balance_reconciliation_log
  WHERE revision = '2026-08-28-all-products';

  IF logged_count = 0 THEN
    RAISE EXCEPTION 'FIFO opening reconciliation backup log is empty';
  END IF;
END;
$$;

COMMIT;
