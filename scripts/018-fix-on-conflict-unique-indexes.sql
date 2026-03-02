-- 修正 ON CONFLICT 無法推導唯一索引的問題
-- 若既有為 partial unique index（WHERE ... IS NOT NULL），會導致 ON CONFLICT(col) 失敗

-- 1) 應收：重建為一般唯一索引（允許多個 NULL，本來就符合需求）
DROP INDEX IF EXISTS uq_accounts_receivable_sales_order_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_receivable_sales_order_id
ON accounts_receivable(sales_order_id);

-- 2) 應付：重建為一般唯一索引
DROP INDEX IF EXISTS uq_accounts_payable_purchase_order_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_payable_purchase_order_id
ON accounts_payable(purchase_order_id);
