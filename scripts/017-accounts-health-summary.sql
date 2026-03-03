-- 應收/應付 健康總結（單一結果表）
-- 一次回傳每個檢查項目的狀態，避免 SQL Editor 只顯示單段結果

WITH paid_at_columns AS (
  SELECT COUNT(*) AS cnt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('accounts_receivable', 'accounts_payable')
    AND column_name = 'paid_at'
),
unique_indexes AS (
  SELECT COUNT(*) AS cnt
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'uq_accounts_receivable_sales_order_id',
      'uq_accounts_payable_purchase_order_id'
    )
),
updated_at_triggers AS (
  SELECT COUNT(*) AS cnt
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'
    AND trigger_name IN (
      'trg_accounts_receivable_set_updated_at',
      'trg_accounts_payable_set_updated_at'
    )
),
ar_duplicates AS (
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT sales_order_id
    FROM accounts_receivable
    WHERE sales_order_id IS NOT NULL
    GROUP BY sales_order_id
    HAVING COUNT(*) > 1
  ) t
),
ap_duplicates AS (
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT purchase_order_id
    FROM accounts_payable
    WHERE purchase_order_id IS NOT NULL
    GROUP BY purchase_order_id
    HAVING COUNT(*) > 1
  ) t
),
ar_amount_anomalies AS (
  SELECT COUNT(*) AS cnt
  FROM accounts_receivable
  WHERE amount_due < 0
     OR paid_amount < 0
      OR COALESCE(overpaid_amount, 0) < 0
     OR paid_amount > amount_due
),
ap_amount_anomalies AS (
  SELECT COUNT(*) AS cnt
  FROM accounts_payable
  WHERE amount_due < 0
     OR paid_amount < 0
     OR paid_amount > amount_due
),
ar_status_mismatch AS (
  SELECT COUNT(*) AS cnt
  FROM accounts_receivable
  WHERE (status = 'paid' AND paid_amount < amount_due)
     OR (status = 'unpaid' AND paid_amount > 0)
     OR (status = 'partially_paid' AND (paid_amount <= 0 OR paid_amount >= amount_due))
),
ap_status_mismatch AS (
  SELECT COUNT(*) AS cnt
  FROM accounts_payable
  WHERE (status = 'paid' AND paid_amount < amount_due)
     OR (status = 'unpaid' AND paid_amount > 0)
     OR (status = 'partially_paid' AND (paid_amount <= 0 OR paid_amount >= amount_due))
)
SELECT 'paid_at_columns_exist(應為2)' AS check_name, cnt::text AS value, CASE WHEN cnt = 2 THEN 'OK' ELSE 'FAIL' END AS status FROM paid_at_columns
UNION ALL
SELECT 'unique_indexes_exist(應為2)', cnt::text, CASE WHEN cnt = 2 THEN 'OK' ELSE 'FAIL' END FROM unique_indexes
UNION ALL
SELECT 'updated_at_triggers_exist(應為2)', cnt::text, CASE WHEN cnt = 2 THEN 'OK' ELSE 'FAIL' END FROM updated_at_triggers
UNION ALL
SELECT 'ar_duplicates(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ar_duplicates
UNION ALL
SELECT 'ap_duplicates(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ap_duplicates
UNION ALL
SELECT 'ar_amount_anomalies(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ar_amount_anomalies
UNION ALL
SELECT 'ap_amount_anomalies(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ap_amount_anomalies
UNION ALL
SELECT 'ar_status_mismatch(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ar_status_mismatch
UNION ALL
SELECT 'ap_status_mismatch(應為0)', cnt::text, CASE WHEN cnt = 0 THEN 'OK' ELSE 'FAIL' END FROM ap_status_mismatch;
