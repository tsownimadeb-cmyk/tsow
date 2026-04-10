-- 應收帳款列表 / 搜尋效能優化索引
-- 建議在 Supabase SQL Editor 執行一次。

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'is_paid'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'customer_cno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_is_paid_customer_cno_order_date ON sales_orders(is_paid, customer_cno, order_date DESC, created_at DESC)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'customer_cno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_cno_created_at ON sales_orders(customer_cno, created_at DESC)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts_receivable' AND column_name = 'sales_order_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_accounts_receivable_sales_order_id ON accounts_receivable(sales_order_id)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'order_no'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_order_no_trgm ON sales_orders USING gin (order_no gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'customer_cno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_cno_trgm ON sales_orders USING gin (customer_cno gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'notes'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_notes_trgm ON sales_orders USING gin (notes gin_trgm_ops)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'code'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_code_trgm ON customers USING gin (code gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'cno'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_cno_trgm ON customers USING gin (cno gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops)';
  END IF;
END $$;
