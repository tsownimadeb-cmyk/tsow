-- 允許安全修改客戶編號（例如 A001 -> A001-OLD）
-- 會同步更新客戶主檔與相關歷史資料，避免舊單據對不到客戶。

BEGIN;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN (
        'public.sales_orders'::regclass,
        'public.accounts_receivable'::regclass,
        'public.sales_returns'::regclass
      )
      AND pg_get_constraintdef(oid) ILIKE '%customer_cno%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',
      target.table_name,
      target.conname
    );
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

CREATE OR REPLACE FUNCTION public.rename_customer_code(p_old_code text, p_new_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := UPPER(TRIM(COALESCE(p_old_code, '')));
  v_new text := UPPER(TRIM(COALESCE(p_new_code, '')));
BEGIN
  IF v_old = '' OR v_new = '' THEN
    RAISE EXCEPTION '客戶編號不可空白';
  END IF;

  IF v_old = v_new THEN
    RETURN jsonb_build_object('success', true, 'message', '客戶編號未變更');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE UPPER(TRIM(COALESCE(code, ''))) = v_new
       OR UPPER(TRIM(COALESCE(cno, ''))) = v_new
  ) THEN
    RAISE EXCEPTION '客戶編號 % 已存在', v_new;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE UPPER(TRIM(COALESCE(code, ''))) = v_old
       OR UPPER(TRIM(COALESCE(cno, ''))) = v_old
  ) THEN
    RAISE EXCEPTION '找不到客戶編號 %', v_old;
  END IF;

  SET CONSTRAINTS ALL DEFERRED;

  UPDATE public.customers
  SET code = v_new,
      cno = v_new,
      updated_at = NOW()
  WHERE UPPER(TRIM(COALESCE(code, ''))) = v_old
     OR UPPER(TRIM(COALESCE(cno, ''))) = v_old;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_orders' AND column_name = 'customer_cno'
  ) THEN
    UPDATE public.sales_orders
    SET customer_cno = v_new
    WHERE UPPER(TRIM(COALESCE(customer_cno, ''))) = v_old;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts_receivable' AND column_name = 'customer_cno'
  ) THEN
    UPDATE public.accounts_receivable
    SET customer_cno = v_new
    WHERE UPPER(TRIM(COALESCE(customer_cno, ''))) = v_old;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'customer_cno'
  ) THEN
    UPDATE public.sales_returns
    SET customer_cno = v_new
    WHERE UPPER(TRIM(COALESCE(customer_cno, ''))) = v_old;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_returns' AND column_name = 'customer_code'
  ) THEN
    UPDATE public.sales_returns
    SET customer_code = v_new
    WHERE UPPER(TRIM(COALESCE(customer_code, ''))) = v_old;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ar_receipts' AND column_name = 'customer_cno'
  ) THEN
    UPDATE public.ar_receipts
    SET customer_cno = v_new
    WHERE UPPER(TRIM(COALESCE(customer_cno, ''))) = v_old;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_code', v_old,
    'new_code', v_new
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_customer_code(text, text) TO anon, authenticated, service_role;

COMMIT;
