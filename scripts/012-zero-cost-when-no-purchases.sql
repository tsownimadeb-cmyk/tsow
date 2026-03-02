BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'purchase_qty_total'
  ) THEN
    UPDATE products
    SET
      cost = 0,
      updated_at = NOW()
    WHERE COALESCE(purchase_qty_total, 0) <= 0
      AND COALESCE(cost, 0) <> 0;
  END IF;
END $$;

COMMIT;
