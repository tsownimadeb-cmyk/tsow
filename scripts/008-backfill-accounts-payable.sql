-- 將現有進貨單回填到應付帳款（避免重複）
INSERT INTO accounts_payable (
  purchase_order_id,
  supplier_id,
  amount_due,
  total_amount,
  paid_amount,
  due_date,
  status
)
SELECT
  po.id,
  po.supplier_id,
  po.total_amount,
  po.total_amount,
  CASE WHEN po.is_paid THEN po.total_amount ELSE 0 END AS paid_amount,
  po.order_date,
  CASE WHEN po.is_paid THEN 'paid' ELSE 'unpaid' END AS status
FROM purchase_orders po
LEFT JOIN accounts_payable ap ON ap.purchase_order_id = po.id
WHERE ap.id IS NULL;
