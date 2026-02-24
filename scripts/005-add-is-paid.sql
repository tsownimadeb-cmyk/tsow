-- 為現有表添加 is_paid 欄位
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;

ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;
