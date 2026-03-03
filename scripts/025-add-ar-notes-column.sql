-- 補齊 accounts_receivable.notes 欄位（供部分沖帳日期/金額紀錄）
-- 可重複執行

ALTER TABLE public.accounts_receivable
ADD COLUMN IF NOT EXISTS notes TEXT;
