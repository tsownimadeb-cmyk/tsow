-- Emergency rollback for 059-reconcile-all-fifo-opening-balances.sql.
-- Do not run after intentionally changing FIFO openings again without first
-- reviewing the saved revision.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.fifo_opening_balance_reconciliation_log
    WHERE revision = '2026-08-28-all-products'
  ) THEN
    RAISE EXCEPTION 'FIFO reconciliation backup revision was not found';
  END IF;
END;
$$;

DELETE FROM public.fifo_opening_balances;

INSERT INTO public.fifo_opening_balances (
  product_code,
  quantity,
  unit_cost,
  source_note
)
SELECT
  product_code,
  old_quantity,
  old_unit_cost,
  old_source_note
FROM public.fifo_opening_balance_reconciliation_log
WHERE revision = '2026-08-28-all-products'
  AND old_quantity > 0
  AND old_unit_cost > 0
ORDER BY product_code;

DELETE FROM public.stock_adjustments
WHERE adjusted_by = 'fifo_opening_reconciliation_2026_08_28'
  AND upper(trim(product_code)) = 'A101';

COMMIT;
