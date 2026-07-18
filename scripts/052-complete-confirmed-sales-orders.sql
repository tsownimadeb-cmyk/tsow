BEGIN;

UPDATE public.sales_orders
SET status = 'completed',
    updated_at = now()
WHERE order_no IN (
  'SO20250126002',
  'SO20260310560',
  '240719',
  'SO20260319744',
  '240830',
  '240886',
  '240912',
  '241134'
)
  AND lower(trim(coalesce(status, ''))) = 'pending';

DO $migration$
DECLARE
  completed_count integer;
  unresolved_count integer;
BEGIN
  SELECT count(*) INTO completed_count
  FROM public.sales_orders
  WHERE order_no IN (
    'SO20250126002', 'SO20260310560', '240719', 'SO20260319744',
    '240830', '240886', '240912', '241134'
  )
    AND lower(trim(coalesce(status, ''))) = 'completed';

  SELECT count(*) INTO unresolved_count
  FROM public.sales_orders
  WHERE lower(trim(coalesce(status, ''))) = 'pending';

  IF completed_count <> 8 THEN
    RAISE EXCEPTION 'Expected 8 confirmed sales orders to be completed, found %', completed_count;
  END IF;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION 'Expected no pending sales orders after confirmation, found %', unresolved_count;
  END IF;
END
$migration$;

COMMIT;
