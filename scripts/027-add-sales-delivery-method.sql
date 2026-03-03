-- 新增銷貨單配送方式欄位
-- 選項：self_delivery(本車配送) / company_delivery(公司配送) / customer_pickup(客戶自取)
-- 預設：self_delivery

ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) NOT NULL DEFAULT 'self_delivery';

ALTER TABLE sales_orders
DROP CONSTRAINT IF EXISTS chk_sales_orders_delivery_method;

ALTER TABLE sales_orders
ADD CONSTRAINT chk_sales_orders_delivery_method
CHECK (delivery_method IN ('self_delivery', 'company_delivery', 'customer_pickup'));

UPDATE sales_orders
SET delivery_method = 'self_delivery'
WHERE delivery_method IS NULL
   OR delivery_method NOT IN ('self_delivery', 'company_delivery', 'customer_pickup');
