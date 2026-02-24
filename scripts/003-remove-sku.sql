-- 移除 SKU 欄位

-- 先移除 SKU 索引
DROP INDEX IF EXISTS idx_products_sku;

-- 移除 SKU 欄位
ALTER TABLE products DROP COLUMN IF EXISTS sku;
