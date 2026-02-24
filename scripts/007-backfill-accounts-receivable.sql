-- 將現有銷貨單回填到應收帳款（避免重複）
INSERT INTO accounts_receivable (
  sales_order_id,
  customer_cno,
  amount_due,
  total_amount,
  paid_amount,
  due_date,
  status
)
SELECT
  so.id,
  so.customer_cno,
  so.total_amount,
  so.total_amount,
  CASE WHEN so.is_paid THEN so.total_amount ELSE 0 END AS paid_amount,
  so.order_date,
  CASE WHEN so.is_paid THEN 'paid' ELSE 'unpaid' END AS status
FROM sales_orders so
LEFT JOIN accounts_receivable ar ON ar.sales_order_id = so.id
WHERE ar.id IS NULL;
