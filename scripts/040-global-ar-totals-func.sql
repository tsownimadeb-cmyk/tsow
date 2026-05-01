-- 計算全域應收帳款統計（不分頁，用於頂部統計方塊）
-- 邏輯與前端 page.tsx 一致：
--   若 AR 記錄存在且 amount_due > 0，使用 ar.amount_due；否則使用 so.total_amount
--   paid_amount 以 AR 記錄為主，上限為 effective amount_due
-- 用法：SELECT * FROM get_global_ar_totals('unpaid');
--       SELECT * FROM get_global_ar_totals('all');

DROP FUNCTION IF EXISTS get_global_ar_totals(text) CASCADE;

CREATE FUNCTION get_global_ar_totals(p_view_mode text DEFAULT 'unpaid')
RETURNS TABLE (
  total_due      numeric,
  total_paid     numeric,
  total_overpaid numeric
) AS $$
  WITH latest_ar AS (
    -- 每筆銷貨單只取最新一筆 AR 記錄（與前端 arMap 邏輯相同）
    SELECT DISTINCT ON (sales_order_id)
      sales_order_id,
      amount_due,
      paid_amount,
      overpaid_amount
    FROM accounts_receivable
    WHERE sales_order_id IS NOT NULL
    ORDER BY sales_order_id,
             COALESCE(updated_at, created_at) DESC NULLS LAST
  )
  SELECT
    -- effective amount_due
    COALESCE(SUM(
      CASE
        WHEN ar.sales_order_id IS NOT NULL AND COALESCE(ar.amount_due, 0) > 0
          THEN ar.amount_due
        ELSE so.total_amount
      END
    ), 0)::numeric AS total_due,

    -- effective paid_amount（上限為 effective amount_due）
    COALESCE(SUM(
      LEAST(
        CASE
          WHEN ar.sales_order_id IS NOT NULL
            THEN COALESCE(
              ar.paid_amount,
              CASE WHEN so.is_paid THEN so.total_amount ELSE 0 END
            )
          WHEN so.is_paid THEN so.total_amount
          ELSE 0
        END,
        CASE
          WHEN ar.sales_order_id IS NOT NULL AND COALESCE(ar.amount_due, 0) > 0
            THEN ar.amount_due
          ELSE so.total_amount
        END
      )
    ), 0)::numeric AS total_paid,

    -- overpaid（溢收款）
    COALESCE(SUM(COALESCE(ar.overpaid_amount, 0)), 0)::numeric AS total_overpaid

  FROM sales_orders so
  LEFT JOIN latest_ar ar ON ar.sales_order_id = so.id
  WHERE p_view_mode = 'all' OR so.is_paid = false;
$$ LANGUAGE SQL STABLE;
