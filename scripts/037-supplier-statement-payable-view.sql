    -- 供應商月結應付帳款 view
    -- 根據 statement_day 自動計算每個廠商的當期應付總額
    -- 當期區間：上個月(N+1) ~ 本月N

    CREATE OR REPLACE VIEW supplier_statement_payable AS
    SELECT
    s.id AS supplier_id,
    s.name AS supplier_name,
    s.statement_day,
    -- 計算區間起訖日
    (
        CASE
        WHEN s.statement_day IS NULL THEN date_trunc('month', CURRENT_DATE)
        ELSE (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') + (s.statement_day || ' days')::interval
        END
    )::date AS period_start,
    (
        CASE
        WHEN s.statement_day IS NULL THEN CURRENT_DATE
        ELSE (date_trunc('month', CURRENT_DATE) + (s.statement_day || ' days')::interval - INTERVAL '1 day')::date
        END
    ) AS period_end,
    -- 應付總額
    COALESCE(SUM(ap.amount_due - ap.paid_amount), 0) AS total_payable
    FROM suppliers s
    LEFT JOIN accounts_payable ap
    ON ap.supplier_id = s.id
    AND ap.status = 'unpaid'
    AND ap.created_at >= (
        CASE
        WHEN s.statement_day IS NULL THEN date_trunc('month', CURRENT_DATE)
        ELSE (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') + (s.statement_day || ' days')::interval
        END
    )
    AND ap.created_at < (
        CASE
        WHEN s.statement_day IS NULL THEN (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')
        ELSE (date_trunc('month', CURRENT_DATE) + (s.statement_day || ' days')::interval)
        END
    )
    GROUP BY s.id, s.name, s.statement_day;