-- 依指定年月與 statement_day 切分月結週期，計算每家廠商該期應付總額
-- 邏輯：結帳日為 N，則該月結帳期間為上月(N+1)~本月(N)
-- 用法：SELECT * FROM supplier_statement_payable_period(2026, 10);

DROP FUNCTION IF EXISTS supplier_statement_payable_period(integer, integer) CASCADE;

CREATE FUNCTION supplier_statement_payable_period(p_year int, p_month int)
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  statement_day int,
  period_start date,
  period_end date,
  total_payable numeric
) AS $$
  WITH date_calc AS (
    SELECT
      s.id,
      s.name,
      s.statement_day,
      CASE
        WHEN s.statement_day IS NULL OR s.statement_day = 31 THEN 
          (make_date(p_year, p_month + 1, 1) - INTERVAL '1 day')::date
        ELSE make_date(p_year, p_month, s.statement_day)
      END AS period_end
    FROM suppliers s
  )
  SELECT
    dc.id::uuid AS supplier_id,
    dc.name::text AS supplier_name,
    dc.statement_day::int AS statement_day,
    (dc.period_end - INTERVAL '1 month' + INTERVAL '1 day')::date AS period_start,
    dc.period_end::date AS period_end,
    COALESCE(SUM(
      CASE
        WHEN ap.id IS NOT NULL AND ap.status != 'paid'
          THEN ap.amount_due - ap.paid_amount
        WHEN ap.id IS NULL AND NOT COALESCE(po.is_paid, false)
          THEN po.total_amount
        ELSE 0
      END
    ), 0)::numeric AS total_payable
  FROM date_calc dc
  LEFT JOIN purchase_orders po
    ON po.supplier_id = dc.id
    AND po.order_date >= (dc.period_end - INTERVAL '1 month' + INTERVAL '1 day')::date
    AND po.order_date <= dc.period_end
  LEFT JOIN accounts_payable ap
    ON ap.purchase_order_id = po.id
  GROUP BY dc.id, dc.name, dc.statement_day, dc.period_end;
$$ LANGUAGE SQL STABLE;
