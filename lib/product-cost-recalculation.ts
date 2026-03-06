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

const IN_FILTER_CHUNK_SIZE = 50

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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    return [items]
  }

  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

async function selectByInChunks<T>(
  supabase: SupabaseLikeClient,
  table: string,
  selectFields: string,
  column: string,
  values: string[],
  errorPrefix: string,
): Promise<T[]> {
  if (values.length === 0) {
    return []
  }

  const rows: T[] = []
  for (const chunk of chunkArray(values, IN_FILTER_CHUNK_SIZE)) {
    const response = await supabase.from(table).select(selectFields).in(column, chunk)
    if (response.error) {
      throw new Error(`${errorPrefix}（${response.error.message}）`)
    }
    rows.push(...((response.data || []) as T[]))
  }

  return rows
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

  const targetItems = await selectByInChunks<PurchaseItemRow>(
    supabase,
    "purchase_order_items",
    "purchase_order_id,order_no,code,quantity,subtotal,unit_price",
    "code",
    normalizedCodes,
    "重算商品成本失敗：讀取進貨明細失敗",
  )

  const relatedOrderIds = Array.from(
    new Set(targetItems.map((row) => String(row.purchase_order_id || "").trim()).filter(Boolean)),
  )
  const relatedOrderNos = Array.from(
    new Set(targetItems.map((row) => String(row.order_no || "").trim()).filter(Boolean)),
  )

  const relatedItemsById = await selectByInChunks<PurchaseItemRow>(
    supabase,
    "purchase_order_items",
    "purchase_order_id,order_no,code,quantity,subtotal,unit_price",
    "purchase_order_id",
    relatedOrderIds,
    "重算商品成本失敗：讀取同單號明細失敗",
  )

  const relatedItemsByOrderNo = await selectByInChunks<PurchaseItemRow>(
    supabase,
    "purchase_order_items",
    "purchase_order_id,order_no,code,quantity,subtotal,unit_price",
    "order_no",
    relatedOrderNos,
    "重算商品成本失敗：讀取同單號明細失敗",
  )

  const allRelatedItems = mergeRows(relatedItemsById, relatedItemsByOrderNo)

  const relatedOrdersById = await selectByInChunks<PurchaseOrderRow>(
    supabase,
    "purchase_orders",
    "id,order_no,shipping_fee",
    "id",
    relatedOrderIds,
    "重算商品成本失敗：讀取進貨單失敗",
  )

  const relatedOrdersByOrderNo = await selectByInChunks<PurchaseOrderRow>(
    supabase,
    "purchase_orders",
    "id,order_no,shipping_fee",
    "order_no",
    relatedOrderNos,
    "重算商品成本失敗：讀取進貨單失敗",
  )

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
