-- 新增沖帳時間欄位（應收 / 應付）
ALTER TABLE accounts_receivable
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE accounts_payable
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

-- 針對已付款且尚未有 paid_at 的舊資料，先以 updated_at 補值
UPDATE accounts_receivable
SET paid_at = updated_at
WHERE status = 'paid' AND paid_at IS NULL;

UPDATE accounts_payable
SET paid_at = updated_at
WHERE status = 'paid' AND paid_at IS NULL;
