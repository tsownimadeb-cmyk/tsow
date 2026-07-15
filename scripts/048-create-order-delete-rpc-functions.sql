BEGIN;

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
  v_stock numeric;
  v_ar record;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '缺少銷貨單 id';
  END IF;

  -- Uses the same lock key as save_sales_order_atomic, so save/delete cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('sales:' || p_order_id::text, 0));

  SELECT status, order_no
  INTO v_status, v_order_no
  FROM public.sales_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'already_deleted', true, 'id', p_order_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales_returns WHERE sales_order_id = p_order_id
  ) THEN
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

    IF LOWER(COALESCE(v_status, '')) = 'completed' THEN
      UPDATE public.products
      SET stock_qty = v_stock + v_item.quantity, updated_at = NOW()
      WHERE code = v_item.code;
    END IF;
  END LOOP;

  DELETE FROM public.accounts_receivable WHERE sales_order_id = p_order_id;
  DELETE FROM public.sales_order_items WHERE sales_order_id = p_order_id;
  DELETE FROM public.sales_orders WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'already_deleted', false,
    'id', p_order_id,
    'order_no', v_order_no
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_purchase_order_atomic(p_order_id uuid)
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
  v_ap record;
  v_total_purchase_quantity numeric;
  v_landed_purchase_amount numeric;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '缺少進貨單 id';
  END IF;

  -- Uses the same lock key as save_purchase_order_atomic, so save/delete cannot race.
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase:' || p_order_id::text, 0));

  SELECT status, order_no
  INTO v_status, v_order_no
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'already_deleted', true, 'id', p_order_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchase_returns WHERE purchase_order_id = p_order_id
  ) THEN
    RAISE EXCEPTION '此進貨單已有退貨紀錄，請先處理退貨關聯後再刪除';
  END IF;

  SELECT id, COALESCE(paid_amount, 0) AS paid_amount, check_no
  INTO v_ap
  FROM public.accounts_payable
  WHERE purchase_order_id = p_order_id
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND (v_ap.paid_amount > 0 OR NULLIF(BTRIM(v_ap.check_no), '') IS NOT NULL) THEN
    RAISE EXCEPTION '此進貨單已有付款或支票紀錄，請先完成帳款沖銷後再刪除';
  END IF;

  SELECT COALESCE(array_agg(code ORDER BY code), ARRAY[]::text[])
  INTO v_codes
  FROM (
    SELECT DISTINCT BTRIM(code) AS code
    FROM public.purchase_order_items
    WHERE (purchase_order_id = p_order_id OR (purchase_order_id IS NULL AND order_no = v_order_no))
      AND NULLIF(BTRIM(code), '') IS NOT NULL
  ) affected;

  FOR v_item IN
    SELECT BTRIM(code) AS code, SUM(COALESCE(quantity, 0))::numeric AS quantity
    FROM public.purchase_order_items
    WHERE (purchase_order_id = p_order_id OR (purchase_order_id IS NULL AND order_no = v_order_no))
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
      RAISE EXCEPTION '找不到商品 %，進貨單未刪除', v_item.code;
    END IF;
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION '商品 % 的進貨數量不合法，進貨單未刪除', v_item.code;
    END IF;

    IF LOWER(COALESCE(v_status, '')) = 'completed' THEN
      IF v_stock < v_item.quantity THEN
        RAISE EXCEPTION '商品 % 現有庫存不足以反向刪除此進貨單，進貨單未刪除', v_item.code;
      END IF;

      UPDATE public.products
      SET stock_qty = v_stock - v_item.quantity, updated_at = NOW()
      WHERE code = v_item.code;
    END IF;
  END LOOP;

  DELETE FROM public.accounts_payable WHERE purchase_order_id = p_order_id;
  DELETE FROM public.purchase_order_items
  WHERE purchase_order_id = p_order_id OR (purchase_order_id IS NULL AND order_no = v_order_no);
  DELETE FROM public.purchase_orders WHERE id = p_order_id;

  -- Recalculate purchase totals and weighted landed cost from the remaining completed orders.
  FOREACH v_code IN ARRAY v_codes LOOP
    WITH order_goods AS (
      SELECT
        poi.purchase_order_id,
        SUM(COALESCE(poi.subtotal, COALESCE(poi.quantity, 0) * COALESCE(poi.unit_price, 0))) AS goods_total
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id IS NOT NULL
      GROUP BY poi.purchase_order_id
    ), product_summary AS (
      SELECT
        COALESCE(SUM(COALESCE(poi.quantity, 0)), 0) AS total_quantity,
        COALESCE(SUM(
          COALESCE(poi.subtotal, COALESCE(poi.quantity, 0) * COALESCE(poi.unit_price, 0)) +
          CASE
            WHEN COALESCE(og.goods_total, 0) > 0 THEN
              COALESCE(poi.subtotal, COALESCE(poi.quantity, 0) * COALESCE(poi.unit_price, 0))
              / og.goods_total * COALESCE(po.shipping_fee, 0)
            ELSE 0
          END
        ), 0) AS landed_amount
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
      LEFT JOIN order_goods og ON og.purchase_order_id = poi.purchase_order_id
      WHERE UPPER(BTRIM(poi.code)) = UPPER(BTRIM(v_code))
        AND COALESCE(poi.quantity, 0) > 0
        AND LOWER(COALESCE(po.status, '')) = 'completed'
    )
    SELECT total_quantity, landed_amount
    INTO v_total_purchase_quantity, v_landed_purchase_amount
    FROM product_summary;

    UPDATE public.products
    SET
      purchase_qty_total = COALESCE(v_total_purchase_quantity, 0),
      cost = CASE
        WHEN COALESCE(v_total_purchase_quantity, 0) > 0
          THEN ROUND(v_landed_purchase_amount / v_total_purchase_quantity, 4)
        ELSE 0
      END,
      updated_at = NOW()
    WHERE code = v_code;
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', true,
    'already_deleted', false,
    'id', p_order_id,
    'order_no', v_order_no
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_sales_order_atomic(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_purchase_order_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_order_atomic(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_purchase_order_atomic(uuid) TO authenticated, service_role;

COMMIT;
