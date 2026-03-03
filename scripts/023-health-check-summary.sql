-- 單一結果版健康檢查（重點：0 / 1 / 4 / 6）
-- 用途：避免 Supabase 多結果集難閱讀，直接輸出 PASS/FAIL

WITH
missing_required AS (
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT 'products' AS table_name, 'code' AS column_name UNION ALL
    SELECT 'products','name' UNION ALL
    SELECT 'products','stock_qty' UNION ALL
    SELECT 'products','safety_stock' UNION ALL
    SELECT 'products','purchase_qty_total' UNION ALL
    SELECT 'products','base_price' UNION ALL
    SELECT 'products','purchase_price' UNION ALL
    SELECT 'customers','code' UNION ALL
    SELECT 'customers','name' UNION ALL
    SELECT 'purchase_orders','order_no' UNION ALL
    SELECT 'sales_orders','order_no' UNION ALL
    SELECT 'accounts_receivable','overpaid_amount' UNION ALL
    SELECT 'purchase_order_items','code' UNION ALL
    SELECT 'purchase_order_items','order_no' UNION ALL
    SELECT 'sales_order_items','code'
  ) ec
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = ec.table_name
   AND c.column_name = ec.column_name
  WHERE c.column_name IS NULL
),
legacy_remaining AS (
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT 'products' AS table_name, 'pname' AS column_name UNION ALL
    SELECT 'products','stock_quantity' UNION ALL
    SELECT 'products','min_stock_level' UNION ALL
    SELECT 'customers','compy' UNION ALL
    SELECT 'purchase_orders','order_number' UNION ALL
    SELECT 'sales_orders','order_number' UNION ALL
    SELECT 'purchase_order_items','product_pno' UNION ALL
    SELECT 'sales_order_items','product_pno'
  ) lc
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = lc.table_name
   AND c.column_name = lc.column_name
),
item_code_mismatch AS (
  SELECT
    (
      SELECT COUNT(*)
      FROM purchase_order_items poi
      LEFT JOIN products p ON UPPER(TRIM(p.code)) = UPPER(TRIM(poi.code))
      WHERE COALESCE(NULLIF(TRIM(poi.code), ''), '') <> ''
        AND p.code IS NULL
    )
    +
    (
      SELECT COUNT(*)
      FROM sales_order_items soi
      LEFT JOIN products p ON UPPER(TRIM(p.code)) = UPPER(TRIM(soi.code))
      WHERE COALESCE(NULLIF(TRIM(soi.code), ''), '') <> ''
        AND p.code IS NULL
    ) AS cnt
),
purchase_header_diff AS (
  SELECT COUNT(*) AS cnt
  FROM (
    WITH purchase_item_sum AS (
      SELECT purchase_order_id, SUM(COALESCE(subtotal, 0)) AS item_total
      FROM purchase_order_items
      GROUP BY purchase_order_id
    )
    SELECT po.id
    FROM purchase_orders po
    LEFT JOIN purchase_item_sum pis ON pis.purchase_order_id = po.id
    WHERE ABS(COALESCE(po.total_amount, 0) - COALESCE(pis.item_total, 0)) >= 0.01
  ) t
),
sales_header_diff AS (
  SELECT COUNT(*) AS cnt
  FROM (
    WITH sales_item_sum AS (
      SELECT sales_order_id, SUM(COALESCE(subtotal, 0)) AS item_total
      FROM sales_order_items
      GROUP BY sales_order_id
    )
    SELECT so.id
    FROM sales_orders so
    LEFT JOIN sales_item_sum sis ON sis.sales_order_id = so.id
    WHERE ABS(COALESCE(so.total_amount, 0) - COALESCE(sis.item_total, 0)) >= 0.01
  ) t
),
product_cost_anomaly AS (
  SELECT COUNT(*) AS cnt
  FROM products
  WHERE COALESCE(purchase_qty_total, 0) > 0
    AND COALESCE(cost, 0) <= 0
)
SELECT '0_required_columns' AS check_key,
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
       cnt AS issue_count
FROM missing_required
UNION ALL
SELECT '1_legacy_columns_remaining',
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
       cnt
FROM legacy_remaining
UNION ALL
SELECT '4_item_code_not_in_products',
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
       cnt
FROM item_code_mismatch
UNION ALL
SELECT '5_products_with_qty_but_zero_cost',
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
       cnt
FROM product_cost_anomaly
UNION ALL
SELECT '6_purchase_header_vs_items_diff',
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
       cnt
FROM purchase_header_diff
UNION ALL
SELECT '6_sales_header_vs_items_diff',
       CASE WHEN cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
       cnt
FROM sales_header_diff
ORDER BY check_key;
