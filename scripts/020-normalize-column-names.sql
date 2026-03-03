-- 統一資料庫欄位命名（向前相容版）
-- 目標標準欄位：
-- products: code, name, stock_qty, safety_stock, purchase_qty_total, base_price, purchase_price
-- customers: code, name
-- purchase_orders / sales_orders: order_no
-- purchase_order_items / sales_order_items: code；purchase_order_items 額外補 order_no
--
-- 說明：
-- 1) 本腳本採「補欄位 + 回填 + 建索引」，不立即刪除舊欄位，避免中斷現有流程。
-- 2) 執行後，應用程式可統一使用新欄位名稱。

BEGIN;

-- =========================
-- products
-- =========================
ALTER TABLE products ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS safety_stock INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_qty_total DECIMAL(14, 4) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_price DECIMAL(12, 4) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(12, 4) DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='pno'
  ) THEN
    EXECUTE '
      UPDATE products
      SET code = COALESCE(NULLIF(code, ''''), NULLIF(pno, ''''))
      WHERE COALESCE(NULLIF(code, ''''), '''') = ''''
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='pname'
  ) THEN
    EXECUTE '
      UPDATE products
      SET name = COALESCE(NULLIF(name, ''''), NULLIF(pname, ''''))
      WHERE COALESCE(NULLIF(name, ''''), '''') = ''''
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='stock_quantity'
  ) THEN
    EXECUTE '
      UPDATE products
      SET stock_qty = COALESCE(stock_qty, 0) + CASE WHEN COALESCE(stock_qty, 0)=0 THEN COALESCE(stock_quantity, 0) ELSE 0 END
      WHERE COALESCE(stock_quantity, 0) <> 0 OR COALESCE(stock_qty, 0)=0
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products' AND column_name='min_stock_level'
  ) THEN
    EXECUTE '
      UPDATE products
      SET safety_stock = CASE WHEN COALESCE(safety_stock, 0)=0 THEN COALESCE(min_stock_level, 0) ELSE safety_stock END
      WHERE COALESCE(min_stock_level, 0) <> 0 OR COALESCE(safety_stock, 0)=0
    ';
  END IF;
END $$;

UPDATE products
SET base_price = COALESCE(NULLIF(base_price, 0), NULLIF(purchase_price, 0), COALESCE(cost, 0))
WHERE COALESCE(base_price, 0) = 0;

UPDATE products
SET purchase_price = COALESCE(NULLIF(purchase_price, 0), NULLIF(base_price, 0), COALESCE(cost, 0))
WHERE COALESCE(purchase_price, 0) = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_code ON products(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);

-- =========================
-- customers
-- =========================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name VARCHAR(200);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='cno'
  ) THEN
    EXECUTE '
      UPDATE customers
      SET code = COALESCE(NULLIF(code, ''''), NULLIF(cno, ''''))
      WHERE COALESCE(NULLIF(code, ''''), '''') = ''''
    ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='compy'
  ) THEN
    EXECUTE '
      UPDATE customers
      SET name = COALESCE(NULLIF(name, ''''), NULLIF(compy, ''''))
      WHERE COALESCE(NULLIF(name, ''''), '''') = ''''
    ';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_code ON customers(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(code);

-- =========================
-- purchase_orders / sales_orders
-- =========================
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS order_no VARCHAR(50);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_fee DECIMAL(12, 2) DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_orders' AND column_name='order_number'
  ) THEN
    EXECUTE '
      UPDATE purchase_orders
      SET order_no = COALESCE(NULLIF(order_no, ''''), NULLIF(order_number, ''''))
      WHERE COALESCE(NULLIF(order_no, ''''), '''') = ''''
    ';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_order_no ON purchase_orders(order_no) WHERE order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_no ON purchase_orders(order_no);

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS order_no VARCHAR(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sales_orders' AND column_name='order_number'
  ) THEN
    EXECUTE '
      UPDATE sales_orders
      SET order_no = COALESCE(NULLIF(order_no, ''''), NULLIF(order_number, ''''))
      WHERE COALESCE(NULLIF(order_no, ''''), '''') = ''''
    ';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_order_no ON sales_orders(order_no) WHERE order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_order_no ON sales_orders(order_no);

-- =========================
-- purchase_order_items / sales_order_items
-- =========================
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS order_no VARCHAR(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_order_items' AND column_name='product_pno'
  ) THEN
    EXECUTE '
      UPDATE purchase_order_items
      SET code = COALESCE(NULLIF(code, ''''), NULLIF(product_pno, ''''))
      WHERE COALESCE(NULLIF(code, ''''), '''') = ''''
    ';
  END IF;
END $$;

UPDATE purchase_order_items poi
SET order_no = COALESCE(
  NULLIF(poi.order_no, ''),
  NULLIF(TRIM(COALESCE(to_jsonb(po)->>'order_no', to_jsonb(po)->>'order_number', '')), '')
)
FROM purchase_orders po
WHERE po.id = poi.purchase_order_id
  AND COALESCE(NULLIF(poi.order_no, ''), '') = '';

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order_no ON purchase_order_items(order_no);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_code ON purchase_order_items(code);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order_code ON purchase_order_items(purchase_order_id, code);

ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS code VARCHAR(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sales_order_items' AND column_name='product_pno'
  ) THEN
    EXECUTE '
      UPDATE sales_order_items
      SET code = COALESCE(NULLIF(code, ''''), NULLIF(product_pno, ''''))
      WHERE COALESCE(NULLIF(code, ''''), '''') = ''''
    ';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_order_items_code ON sales_order_items(code);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_code ON sales_order_items(sales_order_id, code);

-- =========================
-- 回填 products.purchase_qty_total（以進貨明細重算）
-- =========================
WITH purchase_qty AS (
  SELECT
    UPPER(TRIM(code)) AS code_key,
    SUM(COALESCE(quantity, 0))::DECIMAL(14, 4) AS qty
  FROM purchase_order_items
  WHERE COALESCE(NULLIF(TRIM(code), ''), '') <> ''
  GROUP BY UPPER(TRIM(code))
)
UPDATE products p
SET purchase_qty_total = q.qty
FROM purchase_qty q
WHERE UPPER(TRIM(p.code)) = q.code_key;

UPDATE products
SET purchase_qty_total = 0
WHERE purchase_qty_total IS NULL;

COMMIT;
