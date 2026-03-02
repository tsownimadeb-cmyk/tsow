-- 保留每個 sales_order_id 最新的一筆，刪除其餘重複資料
WITH ranked AS (
  SELECT
    id,
    sales_order_id,
    ROW_NUMBER() OVER (
      PARTITION BY sales_order_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM accounts_receivable
  WHERE sales_order_id IS NOT NULL
)
DELETE FROM accounts_receivable ar
USING ranked r
WHERE ar.id = r.id
  AND r.row_num > 1;
