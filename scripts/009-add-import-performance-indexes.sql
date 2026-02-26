-- 匯入效能優化索引（批次 upsert / 增量重算 / 同步刪除）

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_code ON products(code)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'pno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_pno ON products(pno)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(code)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'cno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_cno ON customers(cno)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'order_no'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_no ON purchase_orders(order_no)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'order_number'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_order_number ON purchase_orders(order_number)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'order_no'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_order_no ON sales_orders(order_no)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'order_number'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_order_number ON sales_orders(order_number)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_order_items' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order_code ON purchase_order_items(purchase_order_id, code)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_code ON purchase_order_items(code)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_order_items' AND column_name = 'product_pno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order_pno ON purchase_order_items(purchase_order_id, product_pno)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_order_items_pno ON purchase_order_items(product_pno)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_order_items' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_code ON sales_order_items(sales_order_id, code)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_code ON sales_order_items(code)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_order_items' AND column_name = 'product_code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_product_code ON sales_order_items(sales_order_id, product_code)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_product_code ON sales_order_items(product_code)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_order_items' AND column_name = 'product_pno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_pno ON sales_order_items(sales_order_id, product_pno)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_order_items_pno ON sales_order_items(product_pno)';
  END IF;
END $$;
