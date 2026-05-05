-- ============================================================
-- 進貨退回：更新退回單 + 還原舊庫存、套用新庫存（單一交易）
-- ============================================================
CREATE OR REPLACE FUNCTION update_purchase_return(
  p_return_id   uuid,
  p_total_amount numeric,
  p_items jsonb   -- [{product_id, quantity, unit_price, amount, reason}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_item jsonb;
  v_new_item jsonb;
BEGIN
  -- 1. 還原舊明細的庫存（把之前扣掉的加回來）
  FOR v_old_item IN
    SELECT jsonb_build_object(
      'product_id', product_id,
      'quantity',   quantity
    )
    FROM purchase_return_items
    WHERE purchase_return_id = p_return_id
  LOOP
    UPDATE products
    SET
      stock_qty  = stock_qty + (v_old_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_old_item->>'product_id';
  END LOOP;

  -- 2. 刪除舊明細
  DELETE FROM purchase_return_items
  WHERE purchase_return_id = p_return_id;

  -- 3. 更新主表金額
  UPDATE purchase_returns
  SET
    total_amount = p_total_amount,
    updated_at   = now()
  WHERE id = p_return_id;

  -- 4. 插入新明細並套用新庫存
  FOR v_new_item IN SELECT * FROM jsonb_array_elements(p_items)
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
      p_return_id,
      v_new_item->>'product_id',
      (v_new_item->>'quantity')::integer,
      (v_new_item->>'unit_price')::numeric,
      (v_new_item->>'amount')::numeric,
      v_new_item->>'reason',
      now(),
      now()
    );

    -- 扣庫存（進貨退還供應商）
    UPDATE products
    SET
      stock_qty  = stock_qty - (v_new_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_new_item->>'product_id';
  END LOOP;
END;
$$;


-- ============================================================
-- 銷貨退回：更新退回單 + 還原舊庫存、套用新庫存（單一交易）
-- ============================================================
CREATE OR REPLACE FUNCTION update_sales_return(
  p_return_id    uuid,
  p_total_amount numeric,
  p_items jsonb   -- [{product_code, quantity, unit_price, reason}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_item jsonb;
  v_new_item jsonb;
BEGIN
  -- 1. 還原舊明細的庫存（把之前加回來的扣掉）
  FOR v_old_item IN
    SELECT jsonb_build_object(
      'product_code', product_code,
      'quantity',     quantity
    )
    FROM sales_return_items
    WHERE sales_return_id = p_return_id
  LOOP
    UPDATE products
    SET
      stock_qty  = stock_qty - (v_old_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_old_item->>'product_code';
  END LOOP;

  -- 2. 刪除舊明細
  DELETE FROM sales_return_items
  WHERE sales_return_id = p_return_id;

  -- 3. 更新主表金額
  UPDATE sales_returns
  SET
    total_amount = p_total_amount,
    updated_at   = now()
  WHERE id = p_return_id;

  -- 4. 插入新明細並套用新庫存
  FOR v_new_item IN SELECT * FROM jsonb_array_elements(p_items)
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
      p_return_id,
      v_new_item->>'product_code',
      (v_new_item->>'quantity')::integer,
      (v_new_item->>'unit_price')::numeric,
      v_new_item->>'reason',
      now(),
      now()
    );

    -- 加回庫存（客戶退貨回來）
    UPDATE products
    SET
      stock_qty  = stock_qty + (v_new_item->>'quantity')::integer,
      updated_at = now()
    WHERE code = v_new_item->>'product_code';
  END LOOP;
END;
$$;
