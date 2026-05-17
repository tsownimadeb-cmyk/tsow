-- 診斷客戶毛利計算問題
-- 針對林明岳的訂單進行詳細檢查

-- 1. 確認客戶資料
SELECT code, name FROM customers WHERE name = '林明岳';

-- 2. 取得該客戶的所有訂單
WITH customer_orders AS (
  SELECT 
    so.id,
    so.order_no,
    so.order_date,
    so.total_amount,
    so.customer_cno
  FROM sales_orders so
  WHERE so.customer_cno IN (
    SELECT code FROM customers WHERE name = '林明岳'
  )
  ORDER BY so.order_date DESC
)
-- 3. 取得訂單明細並計算毛利
SELECT 
  co.order_no,
  co.order_date,
  co.total_amount AS 訂單總額,
  soi.code AS 商品編號,
  p.name AS 商品名稱,
  soi.quantity AS 數量,
  soi.unit_price AS 單價,
  soi.subtotal AS 小計,
  p.cost AS 商品成本,
  (soi.quantity * p.cost) AS 總成本,
  (soi.subtotal - soi.quantity * COALESCE(p.cost, 0)) AS 毛利
FROM customer_orders co
LEFT JOIN sales_order_items soi ON soi.sales_order_id = co.id
LEFT JOIN products p ON p.code = soi.code
ORDER BY co.order_date DESC, soi.code;

-- 4. 彙總林明岳的整體毛利
WITH customer_orders AS (
  SELECT so.id, so.total_amount
  FROM sales_orders so
  WHERE so.customer_cno IN (
    SELECT code FROM customers WHERE name = '林明岳'
  )
)
SELECT 
  COUNT(DISTINCT co.id) AS 訂單數,
  SUM(co.total_amount) AS 總營業額,
  SUM(
    COALESCE(
      (SELECT SUM(soi.subtotal - soi.quantity * COALESCE(p.cost, 0))
       FROM sales_order_items soi
       LEFT JOIN products p ON p.code = soi.code
       WHERE soi.sales_order_id = co.id),
      0
    )
  ) AS 總毛利,
  ROUND(
    SUM(
      COALESCE(
        (SELECT SUM(soi.subtotal - soi.quantity * COALESCE(p.cost, 0))
         FROM sales_order_items soi
         LEFT JOIN products p ON p.code = soi.code
         WHERE soi.sales_order_id = co.id),
        0
      )
    ) * 100 / SUM(co.total_amount),
    2
  ) AS 毛利率百分比
FROM customer_orders co;

-- 5. 逐筆訂單統計
WITH customer_orders AS (
  SELECT so.id, so.order_no, so.order_date, so.total_amount
  FROM sales_orders so
  WHERE so.customer_cno IN (
    SELECT code FROM customers WHERE name = '林明岳'
  )
)
SELECT 
  co.order_no,
  co.order_date,
  co.total_amount,
  COALESCE(
    (SELECT SUM(soi.subtotal - soi.quantity * COALESCE(p.cost, 0))
     FROM sales_order_items soi
     LEFT JOIN products p ON p.code = soi.code
     WHERE soi.sales_order_id = co.id),
    0
  ) AS 訂單毛利,
  ROUND(
    COALESCE(
      (SELECT SUM(soi.subtotal - soi.quantity * COALESCE(p.cost, 0))
       FROM sales_order_items soi
       LEFT JOIN products p ON p.code = soi.code
       WHERE soi.sales_order_id = co.id),
      0
    ) * 100 / co.total_amount,
    2
  ) AS 訂單毛利率
FROM customer_orders co
ORDER BY co.order_date DESC;

-- 6. 詳細診斷：負毛利訂單的商品成本問題
-- 檢查是否商品成本異常高
SELECT 
  so.order_no,
  so.order_date,
  soi.code AS 商品編號,
  p.name AS 商品名稱,
  soi.quantity AS 數量,
  soi.unit_price AS 單價,
  soi.subtotal AS 小計,
  COALESCE(p.cost, 0) AS 成本,
  (soi.quantity * COALESCE(p.cost, 0)) AS 總成本,
  (soi.subtotal - soi.quantity * COALESCE(p.cost, 0)) AS 毛利,
  CASE 
    WHEN p.cost IS NULL THEN '【警告】成本為 NULL'
    WHEN p.cost = 0 THEN '【警告】成本為 0'
    WHEN p.cost > soi.unit_price THEN '【異常】成本 > 售價'
    WHEN p.cost > (soi.subtotal / soi.quantity) THEN '【異常】成本過高'
    ELSE 'OK'
  END AS 診斷
FROM sales_orders so
JOIN sales_order_items soi ON soi.sales_order_id = so.id
LEFT JOIN products p ON p.code = soi.code
WHERE so.customer_cno IN (SELECT code FROM customers WHERE name = '林明岳')
  AND (soi.subtotal - soi.quantity * COALESCE(p.cost, 0)) < 0
ORDER BY so.order_date DESC, soi.code;

-- 7. 統計：有多少訂單毛利為負
SELECT 
  COUNT(DISTINCT CASE WHEN gross_profit < 0 THEN so.id END) AS 負毛利訂單數,
  COUNT(DISTINCT so.id) AS 總訂單數,
  SUM(CASE WHEN gross_profit < 0 THEN ABS(gross_profit) ELSE 0 END) AS 虧損總額
FROM sales_orders so
LEFT JOIN (
  SELECT 
    sales_order_id,
    SUM(subtotal - quantity * COALESCE((SELECT cost FROM products WHERE code = soi.code), 0)) AS gross_profit
  FROM sales_order_items soi
  GROUP BY sales_order_id
) profit ON so.id = profit.sales_order_id
WHERE so.customer_cno IN (SELECT code FROM customers WHERE name = '林明岳');
