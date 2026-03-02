-- DB 層防呆：避免同一單據產生重複應收/應付資料

-- 1) 先清理重複資料（保留最新一筆）
WITH ranked_receivable AS (
  SELECT
    id,
    sales_order_id,
    ROW_NUMBER() OVER (
      PARTITION BY sales_order_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM accounts_receivable
  WHERE sales_order_id IS NOT NULL
)
DELETE FROM accounts_receivable ar
USING ranked_receivable rr
WHERE ar.id = rr.id
  AND rr.row_num > 1;

WITH ranked_payable AS (
  SELECT
    id,
    purchase_order_id,
    ROW_NUMBER() OVER (
      PARTITION BY purchase_order_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM accounts_payable
  WHERE purchase_order_id IS NOT NULL
)
DELETE FROM accounts_payable ap
USING ranked_payable rp
WHERE ap.id = rp.id
  AND rp.row_num > 1;

-- 2) 唯一索引：同一單據只能有一筆應收/應付資料
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_receivable_sales_order_id
ON accounts_receivable(sales_order_id)
WHERE sales_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_payable_purchase_order_id
ON accounts_payable(purchase_order_id)
WHERE purchase_order_id IS NOT NULL;

-- 3) 金額合法性約束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_accounts_receivable_amounts'
      AND conrelid = 'accounts_receivable'::regclass
  ) THEN
    ALTER TABLE accounts_receivable
      ADD CONSTRAINT chk_accounts_receivable_amounts
      CHECK (amount_due >= 0 AND paid_amount >= 0 AND paid_amount <= amount_due);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_accounts_payable_amounts'
      AND conrelid = 'accounts_payable'::regclass
  ) THEN
    ALTER TABLE accounts_payable
      ADD CONSTRAINT chk_accounts_payable_amounts
      CHECK (amount_due >= 0 AND paid_amount >= 0 AND paid_amount <= amount_due);
  END IF;
END $$;

-- 4) 狀態合法性約束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_accounts_receivable_status'
      AND conrelid = 'accounts_receivable'::regclass
  ) THEN
    ALTER TABLE accounts_receivable
      ADD CONSTRAINT chk_accounts_receivable_status
      CHECK (status IN ('unpaid', 'partially_paid', 'paid'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_accounts_payable_status'
      AND conrelid = 'accounts_payable'::regclass
  ) THEN
    ALTER TABLE accounts_payable
      ADD CONSTRAINT chk_accounts_payable_status
      CHECK (status IN ('unpaid', 'partially_paid', 'paid'));
  END IF;
END $$;

-- 5) 自動更新 updated_at（避免更新後時間不變）
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_receivable_set_updated_at ON accounts_receivable;
CREATE TRIGGER trg_accounts_receivable_set_updated_at
BEFORE UPDATE ON accounts_receivable
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_accounts_payable_set_updated_at ON accounts_payable;
CREATE TRIGGER trg_accounts_payable_set_updated_at
BEFORE UPDATE ON accounts_payable
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_timestamp();
