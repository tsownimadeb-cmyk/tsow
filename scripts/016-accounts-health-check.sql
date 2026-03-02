-- 應收/應付 健康檢查
-- 用途：確認欄位、索引、trigger、資料一致性是否正常

-- 1) 欄位是否存在（paid_at）
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('accounts_receivable', 'accounts_payable')
  AND column_name = 'paid_at'
ORDER BY table_name;

-- 2) 唯一索引是否存在
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'uq_accounts_receivable_sales_order_id',
    'uq_accounts_payable_purchase_order_id'
  )
ORDER BY tablename, indexname;

-- 3) 觸發器是否存在（updated_at 自動更新）
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND trigger_name IN (
    'trg_accounts_receivable_set_updated_at',
    'trg_accounts_payable_set_updated_at'
  )
ORDER BY table_name, trigger_name;

-- 4) 檢查應收重複（同一 sales_order_id 不應 > 1）
SELECT
  sales_order_id,
  COUNT(*) AS duplicate_count
FROM accounts_receivable
WHERE sales_order_id IS NOT NULL
GROUP BY sales_order_id
HAVING COUNT(*) > 1;

-- 5) 檢查應付重複（同一 purchase_order_id 不應 > 1）
SELECT
  purchase_order_id,
  COUNT(*) AS duplicate_count
FROM accounts_payable
WHERE purchase_order_id IS NOT NULL
GROUP BY purchase_order_id
HAVING COUNT(*) > 1;

-- 6) 檢查金額異常（不應有負數、已收超過應收）
SELECT
  id,
  sales_order_id,
  amount_due,
  paid_amount,
  status,
  updated_at
FROM accounts_receivable
WHERE amount_due < 0
   OR paid_amount < 0
   OR paid_amount > amount_due;

SELECT
  id,
  purchase_order_id,
  amount_due,
  paid_amount,
  status,
  updated_at
FROM accounts_payable
WHERE amount_due < 0
   OR paid_amount < 0
   OR paid_amount > amount_due;

-- 7) 檢查狀態與金額是否一致（應收）
SELECT
  id,
  sales_order_id,
  amount_due,
  paid_amount,
  status,
  paid_at,
  updated_at
FROM accounts_receivable
WHERE (status = 'paid' AND paid_amount < amount_due)
   OR (status = 'unpaid' AND paid_amount > 0)
   OR (status = 'partially_paid' AND (paid_amount <= 0 OR paid_amount >= amount_due));

-- 8) 檢查狀態與金額是否一致（應付）
SELECT
  id,
  purchase_order_id,
  amount_due,
  paid_amount,
  status,
  paid_at,
  updated_at
FROM accounts_payable
WHERE (status = 'paid' AND paid_amount < amount_due)
   OR (status = 'unpaid' AND paid_amount > 0)
   OR (status = 'partially_paid' AND (paid_amount <= 0 OR paid_amount >= amount_due));
