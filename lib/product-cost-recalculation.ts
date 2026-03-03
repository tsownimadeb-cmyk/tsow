type SupabaseLikeClient = {
  from: (table: string) => any
}

type PurchaseItemRow = {
  purchase_order_id: string | null
  order_no: string | null
  code: string | null
  quantity: number | null
  subtotal: number | null
  unit_price: number | null
}

type PurchaseOrderRow = {
  id: string | null
  order_no: string | null
  shipping_fee: number | null
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase()
}

function toNumeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toOrderKey(purchaseOrderId: string | null | undefined, orderNo: string | null | undefined): string {
  const normalizedId = String(purchaseOrderId || "").trim()
  if (normalizedId) return `id:${normalizedId}`

  const normalizedOrderNo = String(orderNo || "").trim()
  if (normalizedOrderNo) return `no:${normalizedOrderNo}`

  return ""
}

function mergeRows<T extends { purchase_order_id?: string | null; order_no?: string | null; code?: string | null; quantity?: number | null; subtotal?: number | null; unit_price?: number | null }>(
  first: T[],
  second: T[],
): T[] {
  const mergedByKey = new Map<string, T>()

  for (const row of [...first, ...second]) {
    const orderKey = toOrderKey(row.purchase_order_id ?? null, row.order_no ?? null)
    const code = String(row.code || "").trim()
    const quantity = toNumeric(row.quantity)
    const subtotal = toNumeric(row.subtotal)
    const unitPrice = toNumeric(row.unit_price)
    const dedupeKey = `${orderKey}|${code}|${quantity}|${subtotal}|${unitPrice}`
    mergedByKey.set(dedupeKey, row)
  }

  return Array.from(mergedByKey.values())
}

export async function recalculateProductCostsByCodes(
  supabase: SupabaseLikeClient,
  inputCodes: string[],
): Promise<void> {
  const normalizedCodes = Array.from(
    new Set(inputCodes.map((code) => normalizeCode(String(code || ""))).filter(Boolean)),
  )

  if (normalizedCodes.length === 0) {
    return
  }

  const targetItemsResponse = await supabase
    .from("purchase_order_items")
    .select("purchase_order_id,order_no,code,quantity,subtotal,unit_price")
    .in("code", normalizedCodes)

  if (targetItemsResponse.error) {
    throw new Error(`重算商品成本失敗：讀取進貨明細失敗（${targetItemsResponse.error.message}）`)
  }

  const targetItems = (targetItemsResponse.data || []) as PurchaseItemRow[]

  const relatedOrderIds = Array.from(
    new Set(targetItems.map((row) => String(row.purchase_order_id || "").trim()).filter(Boolean)),
  )
  const relatedOrderNos = Array.from(
    new Set(targetItems.map((row) => String(row.order_no || "").trim()).filter(Boolean)),
  )

  let relatedItemsById: PurchaseItemRow[] = []
  if (relatedOrderIds.length > 0) {
    const relatedByIdResponse = await supabase
      .from("purchase_order_items")
      .select("purchase_order_id,order_no,code,quantity,subtotal,unit_price")
      .in("purchase_order_id", relatedOrderIds)

    if (relatedByIdResponse.error) {
      throw new Error(`重算商品成本失敗：讀取同單號明細失敗（${relatedByIdResponse.error.message}）`)
    }

    relatedItemsById = (relatedByIdResponse.data || []) as PurchaseItemRow[]
  }

  let relatedItemsByOrderNo: PurchaseItemRow[] = []
  if (relatedOrderNos.length > 0) {
    const relatedByOrderNoResponse = await supabase
      .from("purchase_order_items")
      .select("purchase_order_id,order_no,code,quantity,subtotal,unit_price")
      .in("order_no", relatedOrderNos)

    if (relatedByOrderNoResponse.error) {
      throw new Error(`重算商品成本失敗：讀取同單號明細失敗（${relatedByOrderNoResponse.error.message}）`)
    }

    relatedItemsByOrderNo = (relatedByOrderNoResponse.data || []) as PurchaseItemRow[]
  }

  const allRelatedItems = mergeRows(relatedItemsById, relatedItemsByOrderNo)

  let relatedOrdersById: PurchaseOrderRow[] = []
  if (relatedOrderIds.length > 0) {
    const ordersByIdResponse = await supabase
      .from("purchase_orders")
      .select("id,order_no,shipping_fee")
      .in("id", relatedOrderIds)

    if (ordersByIdResponse.error) {
      throw new Error(`重算商品成本失敗：讀取進貨單失敗（${ordersByIdResponse.error.message}）`)
    }

    relatedOrdersById = (ordersByIdResponse.data || []) as PurchaseOrderRow[]
  }

  let relatedOrdersByOrderNo: PurchaseOrderRow[] = []
  if (relatedOrderNos.length > 0) {
    const ordersByOrderNoResponse = await supabase
      .from("purchase_orders")
      .select("id,order_no,shipping_fee")
      .in("order_no", relatedOrderNos)

    if (ordersByOrderNoResponse.error) {
      throw new Error(`重算商品成本失敗：讀取進貨單失敗（${ordersByOrderNoResponse.error.message}）`)
    }

    relatedOrdersByOrderNo = (ordersByOrderNoResponse.data || []) as PurchaseOrderRow[]
  }

  const shippingByOrderKey = new Map<string, number>()
  for (const order of [...relatedOrdersById, ...relatedOrdersByOrderNo]) {
    const orderKey = toOrderKey(order.id, order.order_no)
    if (!orderKey) continue
    shippingByOrderKey.set(orderKey, toNumeric(order.shipping_fee))
  }

  const goodsTotalByOrderKey = new Map<string, number>()
  for (const row of allRelatedItems) {
    const orderKey = toOrderKey(row.purchase_order_id, row.order_no)
    if (!orderKey) continue

    const quantity = toNumeric(row.quantity)
    const subtotal = toNumeric(row.subtotal)
    const unitPrice = toNumeric(row.unit_price)
    const goodsAmount = subtotal || quantity * unitPrice

    if (!Number.isFinite(goodsAmount) || goodsAmount <= 0) continue

    goodsTotalByOrderKey.set(orderKey, toNumeric(goodsTotalByOrderKey.get(orderKey)) + goodsAmount)
  }

  const summaryByCode = new Map<string, { totalQty: number; landedTotal: number }>()
  for (const row of targetItems) {
    const normalizedCode = normalizeCode(String(row.code || ""))
    if (!normalizedCode) continue

    const quantity = toNumeric(row.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    const subtotal = toNumeric(row.subtotal)
    const unitPrice = toNumeric(row.unit_price)
    const goodsAmount = subtotal || quantity * unitPrice
    const orderKey = toOrderKey(row.purchase_order_id, row.order_no)

    const orderGoodsTotal = toNumeric(goodsTotalByOrderKey.get(orderKey))
    const shippingFee = toNumeric(shippingByOrderKey.get(orderKey))
    const allocatedShipping = orderGoodsTotal > 0 ? (goodsAmount / orderGoodsTotal) * shippingFee : 0
    const landedAmount = goodsAmount + allocatedShipping

    const current = summaryByCode.get(normalizedCode) || { totalQty: 0, landedTotal: 0 }
    current.totalQty += quantity
    current.landedTotal += landedAmount
    summaryByCode.set(normalizedCode, current)
  }

  for (const code of normalizedCodes) {
    const summary = summaryByCode.get(code)
    const totalQty = Number(summary?.totalQty || 0)
    const nextCost = totalQty > 0 ? Number(summary!.landedTotal / totalQty) : 0

    const updateResponse = await supabase
      .from("products")
      .update({
        purchase_qty_total: totalQty,
        cost: Number.isFinite(nextCost) && nextCost > 0 ? nextCost : 0,
      })
      .ilike("code", code)

    if (updateResponse.error) {
      throw new Error(`重算商品成本失敗：更新商品 ${code} 失敗（${updateResponse.error.message}）`)
    }
  }
}
