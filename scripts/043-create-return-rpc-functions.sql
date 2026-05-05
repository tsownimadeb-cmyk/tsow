-- ============================================================
-- 進貨退回：建立退回單 + 扣庫存（單一交易）
-- ============================================================
CREATE OR REPLACE FUNCTION create_purchase_return(
  p_purchase_order_id      text,
  p_purchase_order_number  text,
  p_vendor_code            text,
  p_total_amount           numeric,
  p_return_date            date,
  p_items jsonb   -- [{product_id, quantity, unit_price, amount, reason}]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_return_id uuid;
  v_item      jsonb;
BEGIN
  -- 1. 建立進貨退回主表
  INSERT INTO purchase_returns (
    purchase_order_id,
    purchase_order_number,
    vendor_code,
    total_amount,
    return_date,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_purchase_order_id,
    p_purchase_order_number,
    p_vendor_code,
    p_total_amount,
    p_return_date,
    'completed',
    now(),
    now()
  )
  RETURNING id INTO v_return_id;

  -- 2. 插入明細並扣庫存
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO purchase_return_items (
      purchase_return_id,
      product_id,
      quantity,
      unit_price,
      amount,
      reason,
      created_at,
      updated_at
    ) VALUES (
      v_return_id,
      v_item->>'product_id',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      (v_item->>'amount')::numeric,
      v_item->>'reason',
      now(),
      now()
    );

    -- 扣庫存（進貨退還供應商）
    UPDATE products
    SET
      stock_qty  = stock_qty - (v_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_item->>'product_id';
  END LOOP;

  RETURN v_return_id;
END;
$$;


-- ============================================================
-- 銷貨退回：建立退回單 + 加庫存（單一交易）
-- ============================================================
CREATE OR REPLACE FUNCTION create_sales_return(
  p_sales_order_id   text,
  p_order_number     text,
  p_customer_code    text,
  p_total_amount     numeric,
  p_items jsonb   -- [{product_code, quantity, unit_price, reason}]
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_return_id uuid;
  v_item      jsonb;
BEGIN
  -- 1. 建立銷貨退回主表
  INSERT INTO sales_returns (
    sales_order_id,
    order_number,
    customer_code,
    total_amount,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_sales_order_id,
    p_order_number,
    p_customer_code,
    p_total_amount,
    'completed',
    now(),
    now()
  )
  RETURNING id INTO v_return_id;

  -- 2. 插入明細並加庫存
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sales_return_items (
      sales_return_id,
      product_code,
      quantity,
      unit_price,
      reason,
      created_at,
      updated_at
    ) VALUES (
      v_return_id,
      v_item->>'product_code',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      v_item->>'reason',
      now(),
      now()
    );

    -- 加回庫存（客戶退貨回來）
    UPDATE products
    SET
      stock_qty  = stock_qty + (v_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_item->>'product_code';
  END LOOP;

  RETURN v_return_id;
END;
$$;
