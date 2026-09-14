-- Repair inventory inflated by historical sales/audit deletions and make future
-- sales-order deletion converge to the complete inventory ledger instead of
-- incrementing whatever stock value the client last wrote.
BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_reconciliation_log (
  revision text NOT NULL,
  product_code text NOT NULL,
  old_stock numeric(14, 2) NOT NULL,
  new_stock numeric(14, 2) NOT NULL,
  difference numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision, product_code)
);

ALTER TABLE public.inventory_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users only" ON public.inventory_reconciliation_log;
CREATE POLICY "Authenticated users only"
  ON public.inventory_reconciliation_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.inventory_reconciliation_log FROM PUBLIC, anon;
GRANT ALL ON TABLE public.inventory_reconciliation_log TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inventory_ledger_stock(p_product_code text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((
      SELECT SUM(fob.quantity)
      FROM public.fifo_opening_balances fob
      WHERE UPPER(BTRIM(fob.product_code)) = UPPER(BTRIM(p_product_code))
    ), 0)
    + COALESCE((
      SELECT SUM(poi.quantity)
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po
        ON po.id = poi.purchase_order_id
        OR (poi.purchase_order_id IS NULL AND po.order_no = poi.order_no)
      WHERE UPPER(BTRIM(poi.code)) = UPPER(BTRIM(p_product_code))
        AND LOWER(BTRIM(po.status)) = 'completed'
    ), 0)
    - COALESCE((
      SELECT SUM(soi.quantity)
      FROM public.sales_order_items soi
      JOIN public.sales_orders so ON so.id = soi.sales_order_id
      WHERE UPPER(BTRIM(soi.code)) = UPPER(BTRIM(p_product_code))
        AND LOWER(BTRIM(so.status)) = 'completed'
    ), 0)
    - COALESCE((
      SELECT SUM(pri.quantity)
      FROM public.purchase_return_items pri
      JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
      WHERE UPPER(BTRIM(COALESCE(pri.product_code, pri.product_id::text))) = UPPER(BTRIM(p_product_code))
        AND LOWER(BTRIM(pr.status)) = 'completed'
    ), 0)
    + COALESCE((
      SELECT SUM(sri.quantity)
      FROM public.sales_return_items sri
      JOIN public.sales_returns sr ON sr.id = sri.sales_return_id
      WHERE UPPER(BTRIM(COALESCE(sri.product_code, sri.product_id::text))) = UPPER(BTRIM(p_product_code))
        AND LOWER(BTRIM(sr.status)) = 'completed'
    ), 0)
    + COALESCE((
      SELECT SUM(sa.adjustment_qty)
      FROM public.stock_adjustments sa
      WHERE UPPER(BTRIM(sa.product_code)) = UPPER(BTRIM(p_product_code))
        AND sa.fifo_resolution IN ('dated_increase', 'dated_decrease')
    ), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_ledger_stock(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_ledger_stock(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_sales_order_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_order_no text;
  v_item record;
  v_code text;
  v_codes text[] := ARRAY[]::text[];
  v_stock numeric;
  v_recalculated_stock numeric;
  v_ar record;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '缺少銷貨單 id';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sales:' || p_order_id::text, 0));

  SELECT status, order_no
  INTO v_status, v_order_no
  FROM public.sales_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'already_deleted', true, 'id', p_order_id);
  END IF;

  IF EXISTS (SELECT 1 FROM public.sales_returns WHERE sales_order_id = p_order_id) THEN
    RAISE EXCEPTION '此銷貨單已有退貨紀錄，請先處理退貨關聯後再刪除';
  END IF;

  SELECT id, COALESCE(paid_amount, 0) AS paid_amount,
    COALESCE(overpaid_amount, 0) AS overpaid_amount, check_no
  INTO v_ar
  FROM public.accounts_receivable
  WHERE sales_order_id = p_order_id
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND (
    v_ar.paid_amount > 0 OR v_ar.overpaid_amount > 0 OR NULLIF(BTRIM(v_ar.check_no), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION '此銷貨單已有收款或支票紀錄，請先完成帳款沖銷後再刪除';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ar_receipts
    WHERE sales_order_id = p_order_id
      OR (v_ar.id IS NOT NULL AND ar_id = v_ar.id)
      OR (sales_order_id IS NULL AND ar_id IS NULL AND order_no = v_order_no)
  ) THEN
    RAISE EXCEPTION '此銷貨單已有收款歷程，請先完成帳款沖銷後再刪除';
  END IF;

  SELECT COALESCE(ARRAY_AGG(code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM (
    SELECT DISTINCT BTRIM(code) AS code
    FROM public.sales_order_items
    WHERE sales_order_id = p_order_id
      AND NULLIF(BTRIM(code), '') IS NOT NULL
  ) affected;

  FOR v_item IN
    SELECT BTRIM(code) AS code, SUM(COALESCE(quantity, 0))::numeric AS quantity
    FROM public.sales_order_items
    WHERE sales_order_id = p_order_id
      AND NULLIF(BTRIM(code), '') IS NOT NULL
    GROUP BY BTRIM(code)
    ORDER BY BTRIM(code)
  LOOP
    SELECT COALESCE(stock_qty, 0)
    INTO v_stock
    FROM public.products
    WHERE code = v_item.code
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到商品 %，銷貨單未刪除', v_item.code;
    END IF;
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION '商品 % 的銷貨數量不合法，銷貨單未刪除', v_item.code;
    END IF;
  END LOOP;

  DELETE FROM public.accounts_receivable WHERE sales_order_id = p_order_id;
  DELETE FROM public.sales_order_items WHERE sales_order_id = p_order_id;
  DELETE FROM public.sales_orders WHERE id = p_order_id;

  IF LOWER(COALESCE(v_status, '')) = 'completed' THEN
    FOREACH v_code IN ARRAY v_codes LOOP
      v_recalculated_stock := public.inventory_ledger_stock(v_code);
      UPDATE public.products
      SET stock_qty = v_recalculated_stock, updated_at = NOW()
      WHERE code = v_code;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'already_deleted', false,
    'id', p_order_id,
    'order_no', v_order_no
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_sales_order_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_order_atomic(uuid) TO authenticated, service_role;

CREATE TEMP TABLE inventory_reconciliation_060 (
  product_code text PRIMARY KEY,
  old_stock numeric(14, 2) NOT NULL,
  new_stock numeric(14, 2) NOT NULL
) ON COMMIT DROP;

INSERT INTO inventory_reconciliation_060 (product_code, old_stock, new_stock)
SELECT
  p.code,
  COALESCE(p.stock_qty, 0),
  public.inventory_ledger_stock(p.code)
FROM public.products p
WHERE COALESCE(p.stock_qty, 0) <> public.inventory_ledger_stock(p.code);

DO $$
DECLARE
  negative_details text;
BEGIN
  SELECT STRING_AGG(
    FORMAT('%s: %s -> %s', product_code, old_stock, new_stock),
    '; ' ORDER BY product_code
  )
  INTO negative_details
  FROM inventory_reconciliation_060
  WHERE new_stock < 0;

  IF negative_details IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory reconciliation would create new negative stock: %', negative_details;
  END IF;
END;
$$;

INSERT INTO public.inventory_reconciliation_log (
  revision,
  product_code,
  old_stock,
  new_stock,
  difference
)
SELECT
  '2026-09-15-delete-recovery',
  product_code,
  old_stock,
  new_stock,
  new_stock - old_stock
FROM inventory_reconciliation_060
ON CONFLICT (revision, product_code) DO NOTHING;

UPDATE public.products p
SET stock_qty = correction.new_stock, updated_at = NOW()
FROM inventory_reconciliation_060 correction
WHERE p.code = correction.product_code;

DO $$
DECLARE
  mismatch_details text;
BEGIN
  SELECT STRING_AGG(
    FORMAT('%s expected %s found %s', correction.product_code, correction.new_stock, p.stock_qty),
    '; ' ORDER BY correction.product_code
  )
  INTO mismatch_details
  FROM inventory_reconciliation_060 correction
  JOIN public.products p ON p.code = correction.product_code
  WHERE p.stock_qty <> correction.new_stock;

  IF mismatch_details IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory reconciliation verification failed: %', mismatch_details;
  END IF;
END;
$$;

COMMIT;
