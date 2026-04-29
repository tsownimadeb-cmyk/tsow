-- 商品利潤分析效能索引
-- 目的：加速 sales_orders / sales_order_items / purchase_order_items / accounts_receivable
-- 在利潤分析流程中的關聯與篩選查詢。

CREATE INDEX IF NOT EXISTS idx_sales_orders_status_order_date
ON sales_orders (status, order_date);

CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date_id
ON sales_orders (order_date, id);

CREATE INDEX IF NOT EXISTS idx_sales_order_items_sales_order_id_code
ON sales_order_items (sales_order_id, code);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id_code
ON purchase_order_items (purchase_order_id, code);

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_sales_order_paid_amount
ON accounts_receivable (sales_order_id, paid_amount);
