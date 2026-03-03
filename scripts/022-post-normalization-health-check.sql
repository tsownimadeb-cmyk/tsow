-- 清理後健康檢查（執行 020 + 021 後使用）
-- 目標：快速確認欄位標準化後是否仍有資料/結構風險

-- =====================================================
-- 0) 必要欄位存在檢查（缺任何一欄都應先修）
-- =====================================================
WITH expected_columns AS (
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
  SELECT 'purchase_order_items','code' UNION ALL
  SELECT 'purchase_order_items','order_no' UNION ALL
  SELECT 'sales_order_items','code'
)
SELECT
  ec.table_name,
  ec.column_name,
  CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM expected_columns ec
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = ec.table_name
 AND c.column_name = ec.column_name
ORDER BY ec.table_name, ec.column_name;

-- =====================================================
-- 1) 舊欄位殘留檢查（理想上 remaining_count = 0）
-- =====================================================
WITH legacy_columns AS (
  SELECT 'products' AS table_name, 'pname' AS column_name UNION ALL
  SELECT 'products','stock_quantity' UNION ALL
  SELECT 'products','min_stock_level' UNION ALL
  SELECT 'customers','compy' UNION ALL
  SELECT 'purchase_orders','order_number' UNION ALL
  SELECT 'sales_orders','order_number' UNION ALL
  SELECT 'purchase_order_items','product_pno' UNION ALL
  SELECT 'sales_order_items','product_pno'
)
SELECT
  lc.table_name,
  lc.column_name,
  CASE WHEN c.column_name IS NULL THEN 0 ELSE 1 END AS remaining_count
FROM legacy_columns lc
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = lc.table_name
 AND c.column_name = lc.column_name
ORDER BY lc.table_name, lc.column_name;

-- =====================================================
-- 2) 關鍵欄位空值/空白檢查
-- =====================================================
SELECT 'products.code blank_or_null' AS check_name, COUNT(*) AS issue_count
FROM products
WHERE COALESCE(NULLIF(TRIM(code), ''), '') = ''
UNION ALL
SELECT 'products.name blank_or_null', COUNT(*)
FROM products
WHERE COALESCE(NULLIF(TRIM(name), ''), '') = ''
UNION ALL
SELECT 'customers.code blank_or_null', COUNT(*)
FROM customers
WHERE COALESCE(NULLIF(TRIM(code), ''), '') = ''
UNION ALL
SELECT 'customers.name blank_or_null', COUNT(*)
FROM customers
WHERE COALESCE(NULLIF(TRIM(name), ''), '') = ''
UNION ALL
SELECT 'purchase_orders.order_no blank_or_null', COUNT(*)
FROM purchase_orders
WHERE COALESCE(NULLIF(TRIM(order_no), ''), '') = ''
UNION ALL
SELECT 'sales_orders.order_no blank_or_null', COUNT(*)
FROM sales_orders
WHERE COALESCE(NULLIF(TRIM(order_no), ''), '') = ''
UNION ALL
SELECT 'purchase_order_items.code blank_or_null', COUNT(*)
FROM purchase_order_items
WHERE COALESCE(NULLIF(TRIM(code), ''), '') = ''
UNION ALL
SELECT 'sales_order_items.code blank_or_null', COUNT(*)
FROM sales_order_items
WHERE COALESCE(NULLIF(TRIM(code), ''), '') = '';

-- =====================================================
-- 3) 唯一性檢查（理想上查無資料）
-- =====================================================
SELECT 'products.code duplicate' AS check_name, UPPER(TRIM(code)) AS key_value, COUNT(*) AS duplicate_count
FROM products
GROUP BY UPPER(TRIM(code))
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, key_value;

SELECT 'purchase_orders.order_no duplicate' AS check_name, UPPER(TRIM(order_no)) AS key_value, COUNT(*) AS duplicate_count
FROM purchase_orders
GROUP BY UPPER(TRIM(order_no))
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, key_value;

SELECT 'sales_orders.order_no duplicate' AS check_name, UPPER(TRIM(order_no)) AS key_value, COUNT(*) AS duplicate_count
FROM sales_orders
GROUP BY UPPER(TRIM(order_no))
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, key_value;

-- =====================================================
-- 4) 明細 code 對不到產品主檔（理想上 issue_count = 0）
-- =====================================================
SELECT 'purchase_order_items.code not in products.code' AS check_name, COUNT(*) AS issue_count
FROM purchase_order_items poi
LEFT JOIN products p
  ON UPPER(TRIM(p.code)) = UPPER(TRIM(poi.code))
WHERE COALESCE(NULLIF(TRIM(poi.code), ''), '') <> ''
  AND p.code IS NULL
UNION ALL
SELECT 'sales_order_items.code not in products.code', COUNT(*)
FROM sales_order_items soi
LEFT JOIN products p
  ON UPPER(TRIM(p.code)) = UPPER(TRIM(soi.code))
WHERE COALESCE(NULLIF(TRIM(soi.code), ''), '') <> ''
  AND p.code IS NULL;

-- =====================================================
-- 5) 成本/庫存異常檢查（理想上 issue_count = 0）
-- =====================================================
SELECT 'products.purchase_qty_total > 0 but cost <= 0' AS check_name, COUNT(*) AS issue_count
FROM products
WHERE COALESCE(purchase_qty_total, 0) > 0
  AND COALESCE(cost, 0) <= 0
UNION ALL
SELECT 'products.stock_qty < 0', COUNT(*)
FROM products
WHERE COALESCE(stock_qty, 0) < 0
UNION ALL
SELECT 'products.purchase_qty_total < 0', COUNT(*)
FROM products
WHERE COALESCE(purchase_qty_total, 0) < 0;

-- =====================================================
-- 6) 單頭金額 vs 明細小計檢查（容差 0.01）
-- =====================================================
WITH purchase_item_sum AS (
  SELECT purchase_order_id, SUM(COALESCE(subtotal, 0)) AS item_total
  FROM purchase_order_items
  GROUP BY purchase_order_id
),
purchase_diff AS (
  SELECT
    po.id,
    po.order_no,
    COALESCE(po.total_amount, 0) AS header_total,
    COALESCE(pis.item_total, 0) AS item_total,
    ABS(COALESCE(po.total_amount, 0) - COALESCE(pis.item_total, 0)) AS diff
  FROM purchase_orders po
  LEFT JOIN purchase_item_sum pis ON pis.purchase_order_id = po.id
)
SELECT *
FROM purchase_diff
WHERE diff >= 0.01
ORDER BY diff DESC, order_no;

WITH sales_item_sum AS (
  SELECT sales_order_id, SUM(COALESCE(subtotal, 0)) AS item_total
  FROM sales_order_items
  GROUP BY sales_order_id
),
sales_diff AS (
  SELECT
    so.id,
    so.order_no,
    COALESCE(so.total_amount, 0) AS header_total,
    COALESCE(sis.item_total, 0) AS item_total,
    ABS(COALESCE(so.total_amount, 0) - COALESCE(sis.item_total, 0)) AS diff
  FROM sales_orders so
  LEFT JOIN sales_item_sum sis ON sis.sales_order_id = so.id
)
SELECT *
FROM sales_diff
WHERE diff >= 0.01
ORDER BY diff DESC, order_no;
