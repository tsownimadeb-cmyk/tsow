-- 銷貨／進貨單原子儲存
--
-- 執行此腳本後，單頭、明細、庫存與應收／應付會在同一個 PostgreSQL
-- transaction 內完成；任一步失敗時整筆操作都會回滾。

BEGIN;

-- ============================================================
-- 銷貨：建立或更新單據、明細、庫存、應收（含溢收抵扣）
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_sales_order_atomic(
  p_order_id uuid,
  p_order_no text,
  p_customer_cno text,
  p_delivery_method text,
  p_order_date date,
  p_status text,
  p_is_paid boolean,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := COALESCE(p_order_id, gen_random_uuid());
  v_order_exists boolean := false;
  v_old_status text;
  v_old_quantities jsonb := '{}'::jsonb;
  v_item jsonb;
  v_code text;
  v_quantity integer;
  v_old_quantity numeric;
  v_new_quantity numeric;
  v_delta numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_total_amount numeric := 0;
  v_rows_updated integer;
  v_receivable_id uuid;
  v_existing_paid_amount numeric := 0;
  v_existing_overpaid_amount numeric := 0;
  v_paid_amount numeric := 0;
  v_remaining_amount numeric := 0;
  v_credit record;
  v_credit_amount numeric;
  v_credit_used numeric;
  v_paid_at timestamptz;
  v_final_is_paid boolean := false;
BEGIN
  IF COALESCE(BTRIM(p_order_no), '') = '' THEN
    RAISE EXCEPTION '銷貨單號不可為空';
  END IF;

  IF p_order_date IS NULL THEN
    RAISE EXCEPTION '銷貨日期不可為空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '銷貨明細不可為空';
  END IF;

  -- 先驗證全部明細並由明細重算總額，避免單頭與明細金額不一致。
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_code := BTRIM(COALESCE(v_item->>'code', ''));
    IF v_code = '' THEN
      RAISE EXCEPTION '銷貨明細缺少商品編號';
    END IF;

    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '商品 % 的數量或單價格式錯誤', v_code;
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION '商品 % 的數量必須大於 0', v_code;
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION '商品 % 的單價不可小於 0', v_code;
    END IF;

    v_total_amount := v_total_amount + ROUND(v_quantity * v_unit_price, 2);
  END LOOP;

  -- 同一 UUID 的重送（例如回應途中斷線）必須排隊，避免並行 create 互撞。
  PERFORM pg_advisory_xact_lock(hashtextextended('sales:' || v_order_id::text, 0));

  -- 同一張單的並行更新必須序列化；不存在時則視為可重試的建立操作。
  SELECT status
  INTO v_old_status
  FROM public.sales_orders
  WHERE id = v_order_id
  FOR UPDATE;
  v_order_exists := FOUND;

  IF v_order_exists THEN
    SELECT COALESCE(jsonb_object_agg(code, quantity), '{}'::jsonb)
    INTO v_old_quantities
    FROM (
      SELECT BTRIM(code) AS code, SUM(COALESCE(quantity, 0)) AS quantity
      FROM public.sales_order_items
      WHERE sales_order_id = v_order_id
        AND NULLIF(BTRIM(code), '') IS NOT NULL
        AND LOWER(COALESCE(v_old_status, '')) = 'completed'
      GROUP BY BTRIM(code)
    ) old_items;

    UPDATE public.sales_orders
    SET
      order_no = BTRIM(p_order_no),
      customer_cno = NULLIF(BTRIM(p_customer_cno), ''),
      delivery_method = COALESCE(NULLIF(BTRIM(p_delivery_method), ''), 'self_delivery'),
      order_date = p_order_date,
      total_amount = v_total_amount,
      status = COALESCE(NULLIF(BTRIM(p_status), ''), 'completed'),
      is_paid = COALESCE(p_is_paid, false),
      notes = NULLIF(p_notes, ''),
      updated_at = NOW()
    WHERE id = v_order_id;
  ELSE
    INSERT INTO public.sales_orders (
      id,
      order_no,
      customer_cno,
      delivery_method,
      order_date,
      total_amount,
      status,
      is_paid,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      BTRIM(p_order_no),
      NULLIF(BTRIM(p_customer_cno), ''),
      COALESCE(NULLIF(BTRIM(p_delivery_method), ''), 'self_delivery'),
      p_order_date,
      v_total_amount,
      COALESCE(NULLIF(BTRIM(p_status), ''), 'completed'),
      COALESCE(p_is_paid, false),
      NULLIF(p_notes, ''),
      NOW(),
      NOW()
    );
  END IF;

  DELETE FROM public.sales_order_items
  WHERE sales_order_id = v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_code := BTRIM(v_item->>'code');
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_subtotal := ROUND(v_quantity * v_unit_price, 2);

    INSERT INTO public.sales_order_items (
      sales_order_id,
      code,
      quantity,
      unit_price,
      subtotal,
      created_at
    ) VALUES (
      v_order_id,
      v_code,
      v_quantity,
      v_unit_price,
      v_subtotal,
      NOW()
    );
  END LOOP;

  -- 以商品編號排序鎖定／更新，降低多張單同時儲存時的死鎖機率。
  FOR v_code IN
    SELECT affected.code
    FROM (
      SELECT old_code.code
      FROM jsonb_object_keys(v_old_quantities) AS old_code(code)
      UNION
      SELECT BTRIM(value->>'code')
      FROM jsonb_array_elements(p_items)
    ) affected
    WHERE COALESCE(affected.code, '') <> ''
    ORDER BY affected.code
  LOOP
    v_old_quantity := COALESCE((v_old_quantities->>v_code)::numeric, 0);

    IF LOWER(COALESCE(NULLIF(BTRIM(p_status), ''), 'completed')) = 'completed' THEN
      SELECT COALESCE(SUM((value->>'quantity')::numeric), 0)
      INTO v_new_quantity
      FROM jsonb_array_elements(p_items)
      WHERE BTRIM(value->>'code') = v_code;
    ELSE
      v_new_quantity := 0;
    END IF;

    v_delta := v_new_quantity - v_old_quantity;
    IF v_delta <> 0 THEN
      UPDATE public.products
      SET
        stock_qty = COALESCE(stock_qty, 0) - v_delta,
        updated_at = NOW()
      WHERE code = v_code;

      GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
      IF v_rows_updated <> 1 THEN
        RAISE EXCEPTION '找不到商品 %，銷貨單未儲存', v_code;
      END IF;
    ELSE
      PERFORM 1 FROM public.products WHERE code = v_code;
      IF NOT FOUND THEN
        RAISE EXCEPTION '找不到商品 %，銷貨單未儲存', v_code;
      END IF;
    END IF;
  END LOOP;

  -- 鎖住目標應收資料。既有安裝若有 sales_orders INSERT trigger，這裡會更新
  -- trigger 建立的同一筆資料；沒有 trigger 時則自行建立。
  SELECT id, COALESCE(paid_amount, 0), COALESCE(overpaid_amount, 0), paid_at
  INTO v_receivable_id, v_existing_paid_amount, v_existing_overpaid_amount, v_paid_at
  FROM public.accounts_receivable
  WHERE sales_order_id = v_order_id
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  v_existing_overpaid_amount := GREATEST(COALESCE(v_existing_overpaid_amount, 0), 0);

  IF COALESCE(p_is_paid, false) THEN
    v_paid_amount := v_total_amount;
    v_paid_at := NOW();
  ELSE
    -- 編輯單據時保留既有部分／全部收款；若單據金額降低，超出的收款轉為溢收，
    -- 不會因為畫面上的「已付款」未勾選就把歷史收款歸零。
    v_paid_amount := LEAST(GREATEST(COALESCE(v_existing_paid_amount, 0), 0), v_total_amount);
    v_existing_overpaid_amount := GREATEST(COALESCE(v_existing_overpaid_amount, 0), 0)
      + GREATEST(COALESCE(v_existing_paid_amount, 0) - v_total_amount, 0);

    v_remaining_amount := GREATEST(v_total_amount - v_paid_amount, 0);
    v_credit_used := LEAST(v_existing_overpaid_amount, v_remaining_amount);
    v_existing_overpaid_amount := v_existing_overpaid_amount - v_credit_used;
    v_paid_amount := v_paid_amount + v_credit_used;
    v_remaining_amount := v_remaining_amount - v_credit_used;

    IF v_paid_amount > 0 AND v_paid_at IS NULL THEN
      v_paid_at := NOW();
    ELSIF v_paid_amount <= 0 THEN
      v_paid_at := NULL;
    END IF;
  END IF;

  IF v_receivable_id IS NULL THEN
    INSERT INTO public.accounts_receivable (
      sales_order_id,
      customer_cno,
      amount_due,
      total_amount,
      paid_amount,
      overpaid_amount,
      paid_at,
      due_date,
      status
    ) VALUES (
      v_order_id,
      NULLIF(BTRIM(p_customer_cno), ''),
      v_total_amount,
      v_total_amount,
      v_paid_amount,
      v_existing_overpaid_amount,
      v_paid_at,
      p_order_date,
      CASE
        WHEN COALESCE(p_is_paid, false) OR (v_total_amount > 0 AND v_paid_amount >= v_total_amount) THEN 'paid'
        WHEN v_paid_amount > 0 THEN 'partially_paid'
        ELSE 'unpaid'
      END
    )
    RETURNING id INTO v_receivable_id;
  END IF;

  -- 未直接勾選付款時，依建立時間套用同客戶既有溢收款。
  IF NOT COALESCE(p_is_paid, false)
     AND NULLIF(BTRIM(p_customer_cno), '') IS NOT NULL
     AND v_total_amount > 0 THEN
    FOR v_credit IN
      SELECT id, overpaid_amount
      FROM public.accounts_receivable
      WHERE customer_cno = NULLIF(BTRIM(p_customer_cno), '')
        AND sales_order_id IS DISTINCT FROM v_order_id
        AND COALESCE(overpaid_amount, 0) > 0
      ORDER BY created_at ASC NULLS FIRST, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_amount <= 0;
      v_credit_amount := GREATEST(COALESCE(v_credit.overpaid_amount, 0), 0);
      v_credit_used := LEAST(v_credit_amount, v_remaining_amount);

      UPDATE public.accounts_receivable
      SET
        overpaid_amount = v_credit_amount - v_credit_used,
        updated_at = NOW()
      WHERE id = v_credit.id;

      v_paid_amount := v_paid_amount + v_credit_used;
      v_remaining_amount := v_remaining_amount - v_credit_used;
    END LOOP;

    IF v_paid_amount > 0 THEN
      v_paid_at := NOW();
    END IF;
  END IF;

  v_final_is_paid := COALESCE(p_is_paid, false)
    OR (v_total_amount > 0 AND v_paid_amount >= v_total_amount);

  UPDATE public.accounts_receivable
  SET
    customer_cno = NULLIF(BTRIM(p_customer_cno), ''),
    amount_due = v_total_amount,
    total_amount = v_total_amount,
    paid_amount = LEAST(v_paid_amount, v_total_amount),
    overpaid_amount = v_existing_overpaid_amount,
    paid_at = v_paid_at,
    due_date = p_order_date,
    status = CASE
      WHEN v_final_is_paid THEN 'paid'
      WHEN v_paid_amount > 0 THEN 'partially_paid'
      ELSE 'unpaid'
    END,
    updated_at = NOW()
  WHERE id = v_receivable_id;

  UPDATE public.sales_orders
  SET
    is_paid = v_final_is_paid,
    updated_at = NOW()
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_no', BTRIM(p_order_no),
    'customer_cno', NULLIF(BTRIM(p_customer_cno), ''),
    'order_date', p_order_date,
    'total_amount', v_total_amount,
    'is_paid', v_final_is_paid
  );
END;
$$;


-- ============================================================
-- 進貨：建立或更新單據、明細、庫存、成本、應付
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_purchase_order_atomic(
  p_order_id uuid,
  p_order_no text,
  p_supplier_id uuid,
  p_order_date date,
  p_total_amount numeric,
  p_shipping_fee numeric,
  p_status text,
  p_is_paid boolean,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := COALESCE(p_order_id, gen_random_uuid());
  v_order_exists boolean := false;
  v_old_status text;
  v_old_quantities jsonb := '{}'::jsonb;
  v_item jsonb;
  v_code text;
  v_quantity integer;
  v_old_quantity numeric;
  v_new_quantity numeric;
  v_delta numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_total_amount numeric := 0;
  v_shipping_fee numeric := GREATEST(COALESCE(p_shipping_fee, 0), 0);
  v_rows_updated integer;
  v_total_purchase_quantity numeric;
  v_landed_purchase_amount numeric;
  v_payable_id uuid;
  v_paid_amount numeric;
  v_existing_paid_amount numeric := 0;
  v_paid_at timestamptz;
  v_final_is_paid boolean := false;
BEGIN
  IF COALESCE(BTRIM(p_order_no), '') = '' THEN
    RAISE EXCEPTION '進貨單號不可為空';
  END IF;

  IF p_order_date IS NULL THEN
    RAISE EXCEPTION '進貨日期不可為空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '進貨明細不可為空';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_code := BTRIM(COALESCE(v_item->>'code', ''));
    IF v_code = '' THEN
      RAISE EXCEPTION '進貨明細缺少商品編號';
    END IF;

    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '商品 % 的數量或單價格式錯誤', v_code;
    END;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION '商品 % 的數量必須大於 0', v_code;
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION '商品 % 的單價不可小於 0', v_code;
    END IF;

    v_total_amount := v_total_amount + ROUND(v_quantity * v_unit_price, 2);
  END LOOP;

  -- p_total_amount 保留在介面中供舊客戶端相容；資料庫一律以明細重算值為準。
  PERFORM p_total_amount;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase:' || v_order_id::text, 0));

  SELECT status
  INTO v_old_status
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;
  v_order_exists := FOUND;

  IF v_order_exists THEN
    SELECT COALESCE(jsonb_object_agg(code, quantity), '{}'::jsonb)
    INTO v_old_quantities
    FROM (
      SELECT BTRIM(code) AS code, SUM(COALESCE(quantity, 0)) AS quantity
      FROM public.purchase_order_items
      WHERE purchase_order_id = v_order_id
        AND NULLIF(BTRIM(code), '') IS NOT NULL
        AND LOWER(COALESCE(v_old_status, '')) = 'completed'
      GROUP BY BTRIM(code)
    ) old_items;

    UPDATE public.purchase_orders
    SET
      order_no = BTRIM(p_order_no),
      supplier_id = p_supplier_id,
      order_date = p_order_date,
      total_amount = v_total_amount,
      shipping_fee = v_shipping_fee,
      status = COALESCE(NULLIF(BTRIM(p_status), ''), 'completed'),
      is_paid = COALESCE(p_is_paid, false),
      notes = NULLIF(p_notes, ''),
      updated_at = NOW()
    WHERE id = v_order_id;
  ELSE
    INSERT INTO public.purchase_orders (
      id,
      order_no,
      supplier_id,
      order_date,
      total_amount,
      shipping_fee,
      status,
      is_paid,
      notes,
      created_at,
      updated_at
    ) VALUES (
      v_order_id,
      BTRIM(p_order_no),
      p_supplier_id,
      p_order_date,
      v_total_amount,
      v_shipping_fee,
      COALESCE(NULLIF(BTRIM(p_status), ''), 'completed'),
      COALESCE(p_is_paid, false),
      NULLIF(p_notes, ''),
      NOW(),
      NOW()
    );
  END IF;

  DELETE FROM public.purchase_order_items
  WHERE purchase_order_id = v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_code := BTRIM(v_item->>'code');
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_subtotal := ROUND(v_quantity * v_unit_price, 2);

    INSERT INTO public.purchase_order_items (
      purchase_order_id,
      order_no,
      code,
      quantity,
      unit_price,
      subtotal,
      created_at
    ) VALUES (
      v_order_id,
      BTRIM(p_order_no),
      v_code,
      v_quantity,
      v_unit_price,
      v_subtotal,
      NOW()
    );
  END LOOP;

  FOR v_code IN
    SELECT affected.code
    FROM (
      SELECT old_code.code
      FROM jsonb_object_keys(v_old_quantities) AS old_code(code)
      UNION
      SELECT BTRIM(value->>'code')
      FROM jsonb_array_elements(p_items)
    ) affected
    WHERE COALESCE(affected.code, '') <> ''
    ORDER BY affected.code
  LOOP
    v_old_quantity := COALESCE((v_old_quantities->>v_code)::numeric, 0);

    IF LOWER(COALESCE(NULLIF(BTRIM(p_status), ''), 'completed')) = 'completed' THEN
      SELECT COALESCE(SUM((value->>'quantity')::numeric), 0)
      INTO v_new_quantity
      FROM jsonb_array_elements(p_items)
      WHERE BTRIM(value->>'code') = v_code;
    ELSE
      v_new_quantity := 0;
    END IF;

    v_delta := v_new_quantity - v_old_quantity;

    UPDATE public.products
    SET
      stock_qty = COALESCE(stock_qty, 0) + v_delta,
      updated_at = NOW()
    WHERE code = v_code;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated <> 1 THEN
      RAISE EXCEPTION '找不到商品 %，進貨單未儲存', v_code;
    END IF;

    -- 與既有成本重算規則一致：所有進貨按數量加權，運費依單內商品小計分攤。
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

  SELECT id, COALESCE(paid_amount, 0), paid_at
  INTO v_payable_id, v_existing_paid_amount, v_paid_at
  FROM public.accounts_payable
  WHERE purchase_order_id = v_order_id
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1
  FOR UPDATE;

  IF COALESCE(p_is_paid, false) THEN
    v_paid_amount := v_total_amount;
    v_paid_at := NOW();
  ELSE
    v_existing_paid_amount := GREATEST(COALESCE(v_existing_paid_amount, 0), 0);
    IF v_existing_paid_amount > v_total_amount THEN
      RAISE EXCEPTION '進貨單金額不可低於既有付款金額 %，請先調整應付帳款', v_existing_paid_amount;
    END IF;

    v_paid_amount := v_existing_paid_amount;
    IF v_paid_amount > 0 AND v_paid_at IS NULL THEN
      v_paid_at := NOW();
    ELSIF v_paid_amount <= 0 THEN
      v_paid_at := NULL;
    END IF;
  END IF;

  v_final_is_paid := COALESCE(p_is_paid, false)
    OR (v_total_amount > 0 AND v_paid_amount >= v_total_amount);

  IF v_payable_id IS NULL THEN
    INSERT INTO public.accounts_payable (
      purchase_order_id,
      supplier_id,
      amount_due,
      total_amount,
      paid_amount,
      paid_at,
      due_date,
      status
    ) VALUES (
      v_order_id,
      p_supplier_id,
      v_total_amount,
      v_total_amount,
      v_paid_amount,
      v_paid_at,
      p_order_date,
      CASE
        WHEN v_final_is_paid THEN 'paid'
        WHEN v_paid_amount > 0 THEN 'partially_paid'
        ELSE 'unpaid'
      END
    )
    RETURNING id INTO v_payable_id;
  ELSE
    UPDATE public.accounts_payable
    SET
      supplier_id = p_supplier_id,
      amount_due = v_total_amount,
      total_amount = v_total_amount,
      paid_amount = v_paid_amount,
      paid_at = v_paid_at,
      due_date = p_order_date,
      status = CASE
        WHEN v_final_is_paid THEN 'paid'
        WHEN v_paid_amount > 0 THEN 'partially_paid'
        ELSE 'unpaid'
      END,
      updated_at = NOW()
    WHERE id = v_payable_id;
  END IF;

  UPDATE public.purchase_orders
  SET
    is_paid = v_final_is_paid,
    updated_at = NOW()
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_no', BTRIM(p_order_no),
    'supplier_id', p_supplier_id,
    'order_date', p_order_date,
    'total_amount', v_total_amount,
    'shipping_fee', v_shipping_fee,
    'is_paid', v_final_is_paid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_sales_order_atomic(
  uuid, text, text, text, date, text, boolean, text, jsonb
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.save_purchase_order_atomic(
  uuid, text, uuid, date, numeric, numeric, text, boolean, text, jsonb
) TO anon, authenticated, service_role;

COMMIT;
