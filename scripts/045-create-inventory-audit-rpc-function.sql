CREATE OR REPLACE FUNCTION create_inventory_audit_sales_order(
  p_customer_cno text,
  p_delivery_method text,
  p_status text,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id uuid;
  v_order_no text := 'IA-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substring(md5(random()::text), 1, 6);
  v_item jsonb;
  v_quantity integer;
  v_counted_qty integer;
  v_unit_price numeric := 0;
  v_subtotal numeric := 0;
  v_total numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '盤點資料不可為空';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM customers
    WHERE code = p_customer_cno
  ) THEN
    INSERT INTO customers (
      code,
      name
    )
    VALUES (
      p_customer_cno,
      '客戶自取'
    );
  END IF;

  -- 計算總金額
  FOR v_item IN
    SELECT *
    FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := COALESCE((v_item->>'quantity')::integer, 0);

    IF v_quantity > 0 THEN
      SELECT COALESCE(sale_price, price, 0)
      INTO v_unit_price
      FROM products
      WHERE code = v_item->>'code'
      LIMIT 1;

      v_subtotal := v_quantity * COALESCE(v_unit_price, 0);
      v_total := v_total + v_subtotal;
    END IF;
  END LOOP;

  -- 建立銷貨單
  INSERT INTO sales_orders (
    order_no,
    customer_cno,
    delivery_method,
    status,
    is_paid,
    notes,
    order_date,
    total_amount,
    created_at,
    updated_at
  )
  VALUES (
    v_order_no,
    p_customer_cno,
    p_delivery_method,
    p_status,
    true,
    p_notes,
    now()::date,
    v_total,
    now(),
    now()
  )
  RETURNING id
  INTO v_order_id;

  -- 建立銷貨明細並更新庫存
  FOR v_item IN
    SELECT *
    FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := COALESCE((v_item->>'quantity')::integer, 0);
    v_counted_qty := COALESCE((v_item->>'counted_qty')::integer, 0);

    IF v_quantity > 0 THEN

      SELECT COALESCE(sale_price, price, 0)
      INTO v_unit_price
      FROM products
      WHERE code = v_item->>'code'
      LIMIT 1;

      v_subtotal := v_quantity * COALESCE(v_unit_price, 0);

      INSERT INTO sales_order_items (
        sales_order_id,
        code,
        quantity,
        unit_price,
        subtotal,
        created_at
      )
      VALUES (
        v_order_id,
        v_item->>'code',
        v_quantity,
        v_unit_price,
        v_subtotal,
        now()
      );

    END IF;

    UPDATE products
    SET
      stock_qty = v_counted_qty,
      updated_at = now()
    WHERE code = v_item->>'code';

  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'order_no', v_order_no,
    'total_amount', v_total
  );
END;
$$;