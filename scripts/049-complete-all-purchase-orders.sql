-- In this system, saving a purchase order means the goods were received.
-- Historical CSV imports incorrectly saved orders as "pending". Convert those
-- orders without changing stock_qty: the importer already applied their item
-- quantities to stock when they were imported.

BEGIN;

CREATE TEMP TABLE pending_purchase_codes ON COMMIT DROP AS
SELECT DISTINCT UPPER(BTRIM(poi.code)) AS code
FROM public.purchase_order_items poi
JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
WHERE LOWER(BTRIM(COALESCE(po.status, ''))) IN ('', 'draft', 'pending')
  AND NULLIF(BTRIM(poi.code), '') IS NOT NULL;

UPDATE public.purchase_orders
SET
  status = 'completed',
  updated_at = NOW()
WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('', 'draft', 'pending');

-- Keep the product's lifetime purchase counter aligned with the newly
-- completed historical orders. Deliberately do not touch stock_qty.
UPDATE public.products p
SET
  purchase_qty_total = COALESCE((
    SELECT SUM(COALESCE(poi.quantity, 0))
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE UPPER(BTRIM(poi.code)) = UPPER(BTRIM(p.code))
      AND LOWER(BTRIM(COALESCE(po.status, ''))) = 'completed'
  ), 0),
  updated_at = NOW()
WHERE UPPER(BTRIM(p.code)) IN (SELECT code FROM pending_purchase_codes);

ALTER TABLE public.purchase_orders
  ALTER COLUMN status SET DEFAULT 'completed';

ALTER TABLE public.purchase_orders
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_no_pending_status;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_no_pending_status
  CHECK (LOWER(BTRIM(status)) IN ('completed', 'cancelled'));

COMMIT;
