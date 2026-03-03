-- AR 溢收款欄位：支援多退少補（先結清、計算溢收、下次抵扣）

ALTER TABLE accounts_receivable
ADD COLUMN IF NOT EXISTS overpaid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0;

UPDATE accounts_receivable
SET overpaid_amount = 0
WHERE overpaid_amount IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_accounts_receivable_overpaid_amount'
      AND conrelid = 'accounts_receivable'::regclass
  ) THEN
    ALTER TABLE accounts_receivable
      ADD CONSTRAINT chk_accounts_receivable_overpaid_amount
      CHECK (overpaid_amount >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_customer_overpaid
ON accounts_receivable(customer_cno, overpaid_amount)
WHERE overpaid_amount > 0;
