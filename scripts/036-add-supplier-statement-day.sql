-- 新增 suppliers 月結日欄位 (1-31)
ALTER TABLE suppliers ADD COLUMN statement_day INTEGER CHECK (statement_day >= 1 AND statement_day <= 31);
