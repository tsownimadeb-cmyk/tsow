-- 新增 customers 月結日欄位 (1-31)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS statement_day INTEGER CHECK (statement_day >= 1 AND statement_day <= 31);
