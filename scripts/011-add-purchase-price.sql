-- 新增商品「預設進貨單價」欄位，供進貨單建立時自動帶入
ALTER TABLE products
ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(12, 4) DEFAULT 0;

-- 既有資料回填：若尚未設定預設進貨單價，先沿用目前成本
UPDATE products
SET purchase_price = COALESCE(cost, 0)
WHERE purchase_price IS NULL OR purchase_price = 0;
