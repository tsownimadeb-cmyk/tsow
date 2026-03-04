-- 新增應付帳款支票欄位
-- 可重複執行

ALTER TABLE public.accounts_payable
ADD COLUMN IF NOT EXISTS check_no VARCHAR(100);

ALTER TABLE public.accounts_payable
ADD COLUMN IF NOT EXISTS check_bank VARCHAR(120);

ALTER TABLE public.accounts_payable
ADD COLUMN IF NOT EXISTS check_issue_date DATE;

CREATE INDEX IF NOT EXISTS idx_accounts_payable_check_no
ON public.accounts_payable(check_no);
