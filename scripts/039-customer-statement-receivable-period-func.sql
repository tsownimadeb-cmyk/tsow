-- 依指定年月與 statement_day 切分月結週期，計算每家客戶該期應收總額
-- 邏輯：結帳日為 N，則該月結帳期間為上月(N+1)~本月(N)
-- 用法：SELECT * FROM customer_statement_receivable_period(2026, 10);

DROP FUNCTION IF EXISTS customer_statement_receivable_period(integer, integer) CASCADE;

CREATE FUNCTION customer_statement_receivable_period(p_year int, p_month int)
RETURNS TABLE (
  customer_code varchar,
  customer_name text,
  statement_day int,
  period_start date,
  period_end date,
  total_receivable numeric
) AS $$
  WITH date_calc AS (
    SELECT
      c.code,
      c.name,
      c.statement_day,
      CASE
        WHEN c.statement_day IS NULL OR c.statement_day = 31 THEN 
          (make_date(p_year, p_month + 1, 1) - INTERVAL '1 day')::date
        ELSE make_date(p_year, p_month, c.statement_day)
      END AS period_end
    FROM customers c
  )
  SELECT
    dc.code::varchar AS customer_code,
    dc.name::text AS customer_name,
    dc.statement_day::int AS statement_day,
    (dc.period_end - INTERVAL '1 month' + INTERVAL '1 day')::date AS period_start,
    dc.period_end::date AS period_end,
    COALESCE(SUM(
      CASE
        WHEN ar.id IS NOT NULL AND ar.status != 'paid'
          THEN ar.amount_due - ar.paid_amount
        WHEN ar.id IS NULL AND NOT COALESCE(so.is_paid, false)
          THEN so.total_amount
        ELSE 0
      END
    ), 0)::numeric AS total_receivable
  FROM date_calc dc
  LEFT JOIN sales_orders so
    ON so.customer_cno = dc.code
    AND so.order_date >= (dc.period_end - INTERVAL '1 month' + INTERVAL '1 day')::date
    AND so.order_date <= dc.period_end
  LEFT JOIN accounts_receivable ar
    ON ar.sales_order_id = so.id
  GROUP BY dc.code, dc.name, dc.statement_day, dc.period_end;
$$ LANGUAGE SQL STABLE;
