-- 修復所有成本異常的商品
-- 將 cost 設定為 base_price（正確的進貨成本）

-- 1. 修復所有 cost ≠ base_price 的商品
UPDATE products
SET cost = base_price
WHERE cost IS NOT NULL 
  AND base_price IS NOT NULL 
  AND cost != base_price;

-- 3. 驗證修復結果
SELECT 
  COUNT(*) AS 修復後總商品數,
  SUM(CASE WHEN cost IS NULL OR base_price IS NULL THEN 1 ELSE 0 END) AS 缺少成本資料,
  SUM(CASE WHEN cost > price THEN 1 ELSE 0 END) AS 仍有成本超過售價,
  SUM(CASE WHEN cost > 0 AND base_price > 0 AND ABS(cost - base_price) > LEAST(ABS(cost), ABS(base_price)) * 0.1 THEN 1 ELSE 0 END) AS 仍有差異異常
FROM products;

-- 4. 列出修復前後的樣本（D000 和 A705）
SELECT 
  code,
  name,
  cost,
  base_price,
  price,
  CASE 
    WHEN cost > price THEN '【異常】成本 > 售價'
    WHEN ABS(cost - base_price) > LEAST(ABS(cost), ABS(base_price)) * 0.1 THEN '【異常】差異 > 10%'
    ELSE '【正常】'
  END AS 狀態
FROM products
WHERE code IN ('D000', 'A705');
