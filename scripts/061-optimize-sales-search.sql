-- 銷貨搜尋：由資料庫篩選、計算總筆數、排序及分頁，只傳回當頁單據與完整明細。
-- 可先執行此 migration，再部署網站；舊版網站不受影響。
-- 可重複執行，不修改任何商品、銷貨單、庫存或帳款資料。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- pg_trgm may already live in public or extensions; qualify its operator class.
DO $indexes$
DECLARE
  v_trgm_schema text;
  v_index record;
BEGIN
  SELECT n.nspname INTO v_trgm_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  FOR v_index IN SELECT * FROM (VALUES
    ('idx_products_name_trgm', 'products', 'name'),
    ('idx_products_code_trgm', 'products', 'code'),
    ('idx_sales_order_items_code_trgm', 'sales_order_items', 'code'),
    ('idx_customers_name_trgm', 'customers', 'name'),
    ('idx_sales_orders_order_no_trgm', 'sales_orders', 'order_no'),
    ('idx_sales_orders_customer_cno_trgm', 'sales_orders', 'customer_cno'),
    ('idx_sales_orders_notes_trgm', 'sales_orders', 'notes')
  ) AS indexes(index_name, table_name, column_name)
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I USING gin (%I %I.gin_trgm_ops)',
      v_index.index_name, v_index.table_name, v_index.column_name, v_trgm_schema
    );
  END LOOP;
END;
$indexes$;

CREATE INDEX IF NOT EXISTS idx_sales_orders_search_page
  ON public.sales_orders (order_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_code_order
  ON public.sales_order_items (code, sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_code
  ON public.sales_order_items (sales_order_id, code);

CREATE OR REPLACE FUNCTION public.search_sales_orders_page(
  p_search text DEFAULT '',
  p_product_search text DEFAULT '',
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_search text := BTRIM(COALESCE(p_search, ''));
  v_product_search text := BTRIM(COALESCE(p_product_search, ''));
  -- Treat %, _ and backslash as literal user input, not LIKE wildcards.
  v_search_pattern text := '%' || REPLACE(REPLACE(REPLACE(v_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  v_product_pattern text := '%' || REPLACE(REPLACE(REPLACE(v_product_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_result jsonb;
BEGIN
  WITH matching_products AS MATERIALIZED (
    SELECT p.code
    FROM public.products p
    WHERE v_product_search <> ''
      AND (p.name ILIKE v_product_pattern ESCAPE E'\\' OR p.code ILIKE v_product_pattern ESCAPE E'\\')
  ), product_orders AS MATERIALIZED (
    -- UNION prevents duplicate orders when several matching products occur in one order.
    SELECT i.sales_order_id
    FROM matching_products p
    JOIN public.sales_order_items i ON i.code = p.code
    UNION
    -- Keep code search available for historical items whose product no longer exists.
    SELECT i.sales_order_id
    FROM public.sales_order_items i
    WHERE v_product_search <> '' AND i.code ILIKE v_product_pattern ESCAPE E'\\'
  ), matching_customers AS MATERIALIZED (
    SELECT c.code FROM public.customers c
    WHERE v_search <> '' AND c.name ILIKE v_search_pattern ESCAPE E'\\'
  ), filtered_orders AS NOT MATERIALIZED (
    SELECT s.id, s.order_no, s.customer_cno, s.delivery_method, s.order_date,
           s.total_amount, s.status, s.is_paid, s.notes, s.created_at, s.updated_at
    FROM public.sales_orders s
    WHERE (
      v_search = ''
      OR s.order_no ILIKE v_search_pattern ESCAPE E'\\'
      OR s.customer_cno ILIKE v_search_pattern ESCAPE E'\\'
      OR s.notes ILIKE v_search_pattern ESCAPE E'\\'
      OR s.customer_cno IN (SELECT code FROM matching_customers)
    ) AND (
      v_product_search = ''
      OR s.id IN (SELECT sales_order_id FROM product_orders)
    )
  ), page_orders AS (
    SELECT * FROM filtered_orders
    ORDER BY order_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM filtered_orders),
    'rows', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(s) || jsonb_build_object('items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', i.id, 'sales_order_id', i.sales_order_id, 'code', i.code,
            'quantity', i.quantity, 'unit_price', i.unit_price,
            'subtotal', i.subtotal, 'created_at', i.created_at
          ) ORDER BY i.created_at, i.id)
          FROM public.sales_order_items i WHERE i.sales_order_id = s.id
        ), '[]'::jsonb))
        ORDER BY s.order_date DESC NULLS LAST, s.created_at DESC NULLS LAST, s.id DESC
      ) FROM page_orders s
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Preserve table RLS and restrict RPC access to existing authenticated clients.
REVOKE ALL ON FUNCTION public.search_sales_orders_page(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_sales_orders_page(text, text, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
