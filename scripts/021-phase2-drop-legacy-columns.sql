-- 第二階段清理：移除舊欄位相依（保守版）
-- 前置條件：請先執行 020-normalize-column-names.sql
--
-- 設計原則：
-- 1) 保留識別主鍵欄位（products.pno、customers.cno），避免影響既有 FK 與外部匯入流程
-- 2) 移除已被標準欄位取代的重複欄位
-- 3) 清理舊索引，補上標準欄位索引/約束

BEGIN;

-- =====================================
-- A) 基本健檢（若失敗會中斷）
-- =====================================
DO $$
DECLARE
  missing_products_code integer;
  missing_products_name integer;
  missing_purchase_order_no integer;
  missing_sales_order_no integer;
  missing_purchase_item_code integer;
  missing_sales_item_code integer;
BEGIN
  SELECT COUNT(*) INTO missing_products_code FROM products WHERE COALESCE(NULLIF(TRIM(code), ''), '') = '';
  SELECT COUNT(*) INTO missing_products_name FROM products WHERE COALESCE(NULLIF(TRIM(name), ''), '') = '';
  SELECT COUNT(*) INTO missing_purchase_order_no FROM purchase_orders WHERE COALESCE(NULLIF(TRIM(order_no), ''), '') = '';
  SELECT COUNT(*) INTO missing_sales_order_no FROM sales_orders WHERE COALESCE(NULLIF(TRIM(order_no), ''), '') = '';
  SELECT COUNT(*) INTO missing_purchase_item_code FROM purchase_order_items WHERE COALESCE(NULLIF(TRIM(code), ''), '') = '';
  SELECT COUNT(*) INTO missing_sales_item_code FROM sales_order_items WHERE COALESCE(NULLIF(TRIM(code), ''), '') = '';

  IF missing_products_code > 0 THEN
    RAISE EXCEPTION 'products.code 尚有 % 筆空值，請先修正後再執行第二階段', missing_products_code;
  END IF;
  IF missing_products_name > 0 THEN
    RAISE EXCEPTION 'products.name 尚有 % 筆空值，請先修正後再執行第二階段', missing_products_name;
  END IF;
  IF missing_purchase_order_no > 0 THEN
    RAISE EXCEPTION 'purchase_orders.order_no 尚有 % 筆空值，請先修正後再執行第二階段', missing_purchase_order_no;
  END IF;
  IF missing_sales_order_no > 0 THEN
    RAISE EXCEPTION 'sales_orders.order_no 尚有 % 筆空值，請先修正後再執行第二階段', missing_sales_order_no;
  END IF;
  IF missing_purchase_item_code > 0 THEN
    RAISE EXCEPTION 'purchase_order_items.code 尚有 % 筆空值，請先修正後再執行第二階段', missing_purchase_item_code;
  END IF;
  IF missing_sales_item_code > 0 THEN
    RAISE EXCEPTION 'sales_order_items.code 尚有 % 筆空值，請先修正後再執行第二階段', missing_sales_item_code;
  END IF;
END $$;

-- =====================================
-- B) 收斂約束（標準欄位）
-- =====================================
ALTER TABLE products
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN stock_qty SET DEFAULT 0,
  ALTER COLUMN safety_stock SET DEFAULT 0,
  ALTER COLUMN purchase_qty_total SET DEFAULT 0;

ALTER TABLE purchase_orders
  ALTER COLUMN order_no SET NOT NULL,
  ALTER COLUMN shipping_fee SET DEFAULT 0;

ALTER TABLE sales_orders
  ALTER COLUMN order_no SET NOT NULL;

ALTER TABLE purchase_order_items
  ALTER COLUMN code SET NOT NULL;

ALTER TABLE sales_order_items
  ALTER COLUMN code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_products_code_not_blank'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT chk_products_code_not_blank CHECK (LENGTH(TRIM(code)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_purchase_orders_order_no_not_blank'
      AND conrelid = 'purchase_orders'::regclass
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT chk_purchase_orders_order_no_not_blank CHECK (LENGTH(TRIM(order_no)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_sales_orders_order_no_not_blank'
      AND conrelid = 'sales_orders'::regclass
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT chk_sales_orders_order_no_not_blank CHECK (LENGTH(TRIM(order_no)) > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code ON products(code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_order_no ON purchase_orders(order_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_order_no ON sales_orders(order_no);

-- =====================================
-- C) 清理舊索引（若存在）
-- =====================================
DROP INDEX IF EXISTS idx_purchase_orders_order_number;
DROP INDEX IF EXISTS idx_sales_orders_order_number;
DROP INDEX IF EXISTS idx_purchase_order_items_pno;
DROP INDEX IF EXISTS idx_purchase_order_items_order_pno;
DROP INDEX IF EXISTS idx_sales_order_items_pno;
DROP INDEX IF EXISTS idx_sales_order_items_order_pno;

-- =====================================
-- D) 移除已淘汰舊欄位（安全可刪版）
-- =====================================
-- products: 保留 pno（可能仍被舊 FK/外部資料依賴）
ALTER TABLE products DROP COLUMN IF EXISTS pname;
ALTER TABLE products DROP COLUMN IF EXISTS stock_quantity;
ALTER TABLE products DROP COLUMN IF EXISTS min_stock_level;

-- customers: 保留 cno（仍可能被 sales_orders.customer_cno 參照）
ALTER TABLE customers DROP COLUMN IF EXISTS compy;

-- 單頭舊單號欄位
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS order_number;
ALTER TABLE sales_orders DROP COLUMN IF EXISTS order_number;

-- 明細舊商品欄位
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS product_pno;
ALTER TABLE sales_order_items DROP COLUMN IF EXISTS product_pno;

COMMIT;
