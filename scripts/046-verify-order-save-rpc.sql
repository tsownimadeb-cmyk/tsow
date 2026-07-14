-- Smoke-test both order RPCs through the same anon role used by the app.
-- All temporary orders, stock movements and account rows are rolled back.

BEGIN;
SET LOCAL ROLE anon;

DO $verify$
DECLARE
  v_code text;
  v_sales_id uuid := gen_random_uuid();
  v_purchase_id uuid := gen_random_uuid();
BEGIN
  SELECT code
  INTO v_code
  FROM public.products
  WHERE NULLIF(BTRIM(code), '') IS NOT NULL
  ORDER BY code
  LIMIT 1;

  IF v_code IS NULL THEN
    RAISE EXCEPTION '無商品資料，無法執行 046 smoke test';
  END IF;

  PERFORM public.save_sales_order_atomic(
    v_sales_id,
    'CVS-' || v_sales_id::text,
    NULL,
    'self_delivery',
    CURRENT_DATE,
    'completed',
    true,
    '046 smoke test; transaction will be rolled back',
    jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'quantity', 1,
      'unit_price', 0
    ))
  );

  PERFORM public.save_purchase_order_atomic(
    v_purchase_id,
    'CVP-' || v_purchase_id::text,
    NULL,
    CURRENT_DATE,
    0,
    0,
    'completed',
    true,
    '046 smoke test; transaction will be rolled back',
    jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'quantity', 1,
      'unit_price', 0
    ))
  );
END
$verify$;

ROLLBACK;
