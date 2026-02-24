-- 為現有 products 表添加 sale_price 欄位
ALTER TABLE products
ADD COLUMN IF NOT EXISTS sale_price DECIMAL(12, 2) DEFAULT 0;
