-- 依進貨明細回填 products.cost（含運費按單內小計比例分攤）
-- 適用於：已有進貨資料，但商品成本仍為 0 或不正確
-- 兼容新舊欄位：
--   purchase_order_items.code / product_pno
--   purchase_order_items.order_no / order_number（可能不存在）
--   purchase_orders.order_no / order_number

WITH poi_norm AS (
  SELECT
    poi.purchase_order_id,
    NULLIF(UPPER(TRIM(COALESCE(to_jsonb(poi)->>'code', to_jsonb(poi)->>'product_pno', ''))), '') AS product_code,
    NULLIF(TRIM(COALESCE(to_jsonb(poi)->>'order_no', to_jsonb(poi)->>'order_number', '')), '') AS item_order_no,
    COALESCE(poi.quantity, 0)::numeric AS qty,
    COALESCE(poi.subtotal, COALESCE(poi.quantity, 0) * COALESCE(poi.unit_price, 0))::numeric AS goods_amount
  FROM purchase_order_items poi
),
po_norm AS (
  SELECT
    po.id,
    NULLIF(TRIM(COALESCE(to_jsonb(po)->>'order_no', to_jsonb(po)->>'order_number', '')), '') AS po_order_no,
    COALESCE(po.shipping_fee, 0)::numeric AS shipping_fee
  FROM purchase_orders po
),
linked_items AS (
  SELECT
    COALESCE(pn.purchase_order_id, po.id) AS purchase_order_id,
    pn.product_code,
    pn.qty,
    pn.goods_amount,
    po.shipping_fee
  FROM poi_norm pn
  LEFT JOIN po_norm po
    ON po.id = pn.purchase_order_id
    OR (
      pn.purchase_order_id IS NULL
      AND pn.item_order_no IS NOT NULL
      AND pn.item_order_no = po.po_order_no
    )
  WHERE pn.product_code IS NOT NULL
    AND pn.qty > 0
    AND COALESCE(pn.purchase_order_id, po.id) IS NOT NULL
),
order_goods AS (
  SELECT
    purchase_order_id,
    SUM(goods_amount) AS goods_total
  FROM linked_items
  GROUP BY purchase_order_id
),
product_cost_summary AS (
  SELECT
    li.product_code,
    SUM(li.qty) AS total_qty,
    SUM(
      li.goods_amount +
      CASE
        WHEN COALESCE(og.goods_total, 0) > 0 THEN li.goods_amount / og.goods_total * COALESCE(li.shipping_fee, 0)
        ELSE 0
      END
    ) AS landed_total
  FROM linked_items li
  LEFT JOIN order_goods og
    ON og.purchase_order_id = li.purchase_order_id
  GROUP BY li.product_code
  HAVING SUM(li.qty) > 0
)
UPDATE products p
SET
  purchase_qty_total = pcs.total_qty,
  cost = ROUND((pcs.landed_total / pcs.total_qty)::numeric, 4)
FROM product_cost_summary pcs
WHERE NULLIF(UPPER(TRIM(to_jsonb(p)->>'code')), '') = pcs.product_code
  OR NULLIF(UPPER(TRIM(to_jsonb(p)->>'pno')), '') = pcs.product_code;
