-- 檢查所有商品的成本欄位是否有異常
-- 找出 cost 和 base_price 差異過大的商品

SELECT 
  code,
  name,
  cost,
  base_price,
  purchase_price,
  price,
  ROUND(
    CASE 
      WHEN base_price = 0 THEN 0 
      ELSE ABS(cost - base_price) / base_price * 100 
    END,
    2
  ) AS cost_vs_base_差異百分比,
  CASE 
    WHEN cost IS NULL THEN '【警告】cost 為 NULL'
    WHEN base_price IS NULL THEN '【警告】base_price 為 NULL'
    WHEN cost > price THEN '【致命】成本 > 售價'
    WHEN ABS(cost - base_price) > LEAST(ABS(cost), ABS(base_price)) * 0.1 THEN '【異常】差異 > 10%'
    ELSE 'OK'
  END AS 診斷
FROM products
WHERE cost IS NOT NULL AND base_price IS NOT NULL
  AND (cost > price OR ABS(cost - base_price) > LEAST(ABS(cost), ABS(base_price)) * 0.1)
ORDER BY 
  CASE WHEN cost > price THEN 0 ELSE 1 END,
  cost DESC;

-- 統計有問題的商品
SELECT 
  COUNT(*) AS 總商品數,
  SUM(CASE WHEN cost IS NULL OR base_price IS NULL THEN 1 ELSE 0 END) AS 缺少成本資料,
  SUM(CASE WHEN cost > price THEN 1 ELSE 0 END) AS 成本超過售價_致命,
  SUM(CASE WHEN cost > 0 AND base_price > 0 AND cost <= price AND ABS(cost - base_price) > LEAST(ABS(cost), ABS(base_price)) * 0.1 THEN 1 ELSE 0 END) AS 成本差異異常
FROM products;
