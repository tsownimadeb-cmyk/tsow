-- 修復 sales_orders 與 accounts_receivable 同步衝突（避免 uq_accounts_receivable_sales_order_id）
-- 背景：若資料庫中存在多個會寫入 accounts_receivable 的 sales_orders trigger，
-- 可能在建立銷貨單時造成重複 insert。

-- 1) 清掉所有「會碰 accounts_receivable」的 sales_orders 觸發器（保留其他非相關 trigger）
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.sales_orders'::regclass
      AND NOT t.tgisinternal
      AND pg_get_functiondef(p.oid) ILIKE '%accounts_receivable%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.sales_orders;', r.tgname);
  END LOOP;
END $$;

-- 2) 建立唯一且可重複執行的 trigger function（僅在 INSERT 時建立/更新 AR）
CREATE OR REPLACE FUNCTION public.sync_ar_on_sales_order_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.accounts_receivable (
    sales_order_id,
    customer_cno,
    amount_due,
    total_amount,
    paid_amount,
    overpaid_amount,
    paid_at,
    due_date,
    status
  )
  VALUES (
    NEW.id,
    NEW.customer_cno,
    COALESCE(NEW.total_amount, 0),
    COALESCE(NEW.total_amount, 0),
    CASE WHEN COALESCE(NEW.is_paid, false) THEN COALESCE(NEW.total_amount, 0) ELSE 0 END,
    0,
    CASE WHEN COALESCE(NEW.is_paid, false) THEN NOW() ELSE NULL END,
    NEW.order_date,
    CASE WHEN COALESCE(NEW.is_paid, false) THEN 'paid' ELSE 'unpaid' END
  )
  ON CONFLICT (sales_order_id)
  DO UPDATE SET
    customer_cno = EXCLUDED.customer_cno,
    amount_due = EXCLUDED.amount_due,
    total_amount = EXCLUDED.total_amount,
    paid_amount = EXCLUDED.paid_amount,
    due_date = EXCLUDED.due_date,
    status = EXCLUDED.status,
    paid_at = EXCLUDED.paid_at,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ar_on_sales_order_insert ON public.sales_orders;
CREATE TRIGGER trg_sync_ar_on_sales_order_insert
AFTER INSERT ON public.sales_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_ar_on_sales_order_insert();

-- 3) 可選：驗證目前 sales_orders trigger
-- SELECT trigger_name, action_timing, event_manipulation
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public' AND event_object_table = 'sales_orders'
-- ORDER BY trigger_name;
