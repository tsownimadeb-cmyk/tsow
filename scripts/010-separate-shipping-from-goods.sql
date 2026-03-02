-- 將舊資料中「進貨單 total_amount 含運費」轉換為「total_amount 僅商品金額」
-- 判斷條件：total_amount ≈ 商品小計合計 + shipping_fee，避免重複扣減

BEGIN;

WITH item_totals AS (
  SELECT
    po.id,
    COALESCE(SUM(COALESCE(poi.subtotal, 0)), 0) AS goods_amount
  FROM purchase_orders po
  LEFT JOIN purchase_order_items poi
    ON poi.purchase_order_id = po.id
    OR (
      poi.purchase_order_id IS NULL
      AND COALESCE(TRIM(poi.order_no), '') <> ''
      AND poi.order_no = po.order_no
    )
  GROUP BY po.id
),
target_orders AS (
  SELECT
    po.id,
    item_totals.goods_amount
  FROM purchase_orders po
  JOIN item_totals ON item_totals.id = po.id
  WHERE COALESCE(po.shipping_fee, 0) > 0
    AND ABS(COALESCE(po.total_amount, 0) - (item_totals.goods_amount + COALESCE(po.shipping_fee, 0))) < 0.01
)
UPDATE purchase_orders po
SET
  total_amount = target_orders.goods_amount,
  updated_at = NOW()
FROM target_orders
WHERE po.id = target_orders.id;

WITH item_totals AS (
  SELECT
    po.id,
    COALESCE(SUM(COALESCE(poi.subtotal, 0)), 0) AS goods_amount
  FROM purchase_orders po
  LEFT JOIN purchase_order_items poi
    ON poi.purchase_order_id = po.id
    OR (
      poi.purchase_order_id IS NULL
      AND COALESCE(TRIM(poi.order_no), '') <> ''
      AND poi.order_no = po.order_no
    )
  GROUP BY po.id
),
target_orders AS (
  SELECT po.id
  FROM purchase_orders po
  JOIN item_totals ON item_totals.id = po.id
  WHERE COALESCE(po.shipping_fee, 0) > 0
    AND ABS(COALESCE(po.total_amount, 0) - item_totals.goods_amount) < 0.01
),
ap_next AS (
  SELECT
    ap.id,
    po.total_amount AS goods_amount,
    CASE
      WHEN COALESCE(ap.status, '') = 'paid' OR COALESCE(po.is_paid, false) THEN po.total_amount
      ELSE LEAST(COALESCE(ap.paid_amount, 0), po.total_amount)
    END AS next_paid_amount
  FROM accounts_payable ap
  JOIN purchase_orders po ON po.id = ap.purchase_order_id
  JOIN target_orders t ON t.id = po.id
)
UPDATE accounts_payable ap
SET
  amount_due = ap_next.goods_amount,
  total_amount = ap_next.goods_amount,
  paid_amount = ap_next.next_paid_amount,
  status = CASE
    WHEN ap_next.goods_amount > 0 AND ap_next.next_paid_amount >= ap_next.goods_amount THEN 'paid'
    WHEN ap_next.next_paid_amount > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END,
  updated_at = NOW()
FROM ap_next
WHERE ap.id = ap_next.id;

COMMIT;
