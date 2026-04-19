import type { Product as ProductType } from "@/lib/types"

export type ProductListRow = Pick<
  ProductType,
  "code" | "name" | "spec" | "unit" | "category" | "base_price" | "purchase_price" | "cost" | "price" | "sale_price" | "supplier_id"
> & {
  stock_qty: number
  purchase_qty_total: number
  safety_stock: number
}

export interface ProductProfitSummary {
  sales_qty_total: number
  sales_amount_total: number
}

export interface ProductProfitAnalysisSummary extends ProductProfitSummary {
  cash_received_total: number
  fifo_cogs_total: number
  latest_purchase_price: number
}

export type ProductListRowWithProfit = ProductListRow & {
  sales_qty_total: number
  sales_amount_total: number
  cogs_total: number
  gross_profit: number
  gross_margin: number
  cash_received_total: number
  cash_cogs_total: number
  cash_gross_profit: number
  cash_gross_margin: number
  latest_purchase_price: number
}

type ProfitAnalysisOptions = {
  startDate?: string
  endDate?: string
}

const IN_FILTER_CHUNK_SIZE = 200

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

export function normalizeProducts(rows: any[]): ProductListRow[] {
  return rows.map((row) => ({
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    spec: (row.spec ?? row.specification ?? null) as string | null,
    unit: (row.unit ?? null) as string | null,
    category: (row.category ?? null) as string | null,
    base_price: Number(row.base_price ?? row.purchase_price ?? row.cost ?? 0),
    purchase_price: row.purchase_price === null || row.purchase_price === undefined ? undefined : Number(row.purchase_price),
    cost: Number(Number(row.purchase_qty_total ?? 0) > 0 ? row.cost ?? 0 : 0),
    price: Number(row.price ?? 0),
    sale_price: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    supplier_id: row.supplier_id == null ? null : String(row.supplier_id),
    stock_qty: Number(row.stock_qty ?? 0),
    purchase_qty_total: Number(row.purchase_qty_total ?? 0),
    safety_stock: Number(row.safety_stock ?? 0),
  }))
}

export async function fetchProductsRows(supabase: any, from: number = 0, to: number = 19, searchText: string = "") {
  const queryByPriority = [
    "code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
  ]

  for (const selectText of queryByPriority) {
    let query = supabase
      .from("products")
      .select(selectText, { count: "exact" })
      .order("code", { ascending: true })
      .range(from, to)
    if (searchText && searchText.trim() !== "") {
      query = query.or(`code.ilike.%${searchText}%,name.ilike.%${searchText}%,spec.ilike.%${searchText}%,category.ilike.%${searchText}%`)
    }
    const result = await query
    if (!result.error) {
      return {
        rows: result.data || [],
        totalCount: result.count ?? 0,
        warning: null as string | null,
      }
    }
  }

  let finalQuery = supabase
    .from("products")
    .select("code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id", { count: "exact" })
    .order("code", { ascending: true })
    .range(from, to)
  if (searchText && searchText.trim() !== "") {
    finalQuery = finalQuery.or(`code.ilike.%${searchText}%,name.ilike.%${searchText}%,spec.ilike.%${searchText}%,category.ilike.%${searchText}%`)
  }
  const finalAttempt = await finalQuery

  return {
    rows: finalAttempt.data || [],
    totalCount: finalAttempt.count ?? 0,
    warning: finalAttempt.error?.message || "products 查詢失敗，已回退為基本欄位",
  }
}

export async function fetchProductProfitSummaryByCode(
  supabase: any,
  productCodes: string[],
): Promise<{ summaryByCode: Map<string, ProductProfitSummary>; warning: string | null }> {
  const { summaryByCode, warning } = await fetchProductProfitAnalysisByCode(supabase, productCodes)
  const basicSummaryByCode = new Map<string, ProductProfitSummary>()

  for (const [code, summary] of summaryByCode.entries()) {
    basicSummaryByCode.set(code, {
      sales_qty_total: summary.sales_qty_total,
      sales_amount_total: summary.sales_amount_total,
    })
  }

  return { summaryByCode: basicSummaryByCode, warning }
}

// ─── FIFO helpers ─────────────────────────────────────────────────────────────

type FifoBatch = { orderedAt: string; remainingQty: number; landedUnitCost: number }

function consumeFifo(batches: FifoBatch[], qty: number): number {
  let remaining = qty
  let cogs = 0
  for (const batch of batches) {
    if (remaining <= 0) break
    const used = Math.min(remaining, batch.remainingQty)
    cogs += used * batch.landedUnitCost
    batch.remainingQty -= used
    remaining -= used
  }
  return cogs
}

// ─── fetchProductProfitAnalysisByCode (FIFO) ──────────────────────────────────
//
// 成本計算邏輯（先進先出）：
//   1. 取得所有時間的進貨批次，依進貨日期排序建立 FIFO 佇列。
//   2. 取得所有時間的銷貨明細，依銷售日期排序，逐筆消耗 FIFO 佇列（確保跨期間的
//      庫存消耗順序正確）。
//   3. 僅將落在指定日期區間內的銷售計入報表統計。

export async function fetchProductProfitAnalysisByCode(
  supabase: any,
  productCodes: string[],
  options?: ProfitAnalysisOptions,
): Promise<{ summaryByCode: Map<string, ProductProfitAnalysisSummary>; warning: string | null }> {
  const normalizedCodes = Array.from(new Set(productCodes.map((code) => normalizeCode(code)).filter(Boolean)))
  const codeSet = new Set(normalizedCodes)

  if (normalizedCodes.length === 0) {
    return { summaryByCode: new Map<string, ProductProfitAnalysisSummary>(), warning: null }
  }

  const warningMessages: string[] = []
  const hasValidDateText = (v: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))
  const startDate = hasValidDateText(options?.startDate) ? String(options?.startDate) : undefined
  const endDate = hasValidDateText(options?.endDate) ? String(options?.endDate) : undefined

  const isInPeriod = (dateStr: string) => {
    if (startDate && dateStr < startDate) return false
    if (endDate && dateStr > endDate) return false
    return true
  }

  // ── Step 1: Build FIFO queues from purchase history ──────────────────────────

  type PurchaseItemRow = { purchase_order_id: string; code: string; quantity: number; subtotal: number; unit_price: number }
  const purchaseItems: PurchaseItemRow[] = []
  for (const chunk of chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase
      .from("purchase_order_items")
      .select("purchase_order_id,code,quantity,subtotal,unit_price")
      .in("code", chunk)
    if (result.error) {
      warningMessages.push("讀取進貨明細失敗：" + result.error.message)
    } else {
      purchaseItems.push(...(result.data || []))
    }
  }

  const purchaseOrderIds = Array.from(new Set(purchaseItems.map((r) => String(r.purchase_order_id || "")).filter(Boolean)))
  type PurchaseOrderRow = { id: string; order_date: string; shipping_fee: number }
  const purchaseOrders: PurchaseOrderRow[] = []
  for (const chunk of chunkArray(purchaseOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase.from("purchase_orders").select("id,order_date,shipping_fee").in("id", chunk)
    if (result.error) {
      warningMessages.push("讀取進貨單失敗：" + result.error.message)
    } else {
      purchaseOrders.push(...(result.data || []))
    }
  }

  const purchaseOrderMap = new Map(purchaseOrders.map((o) => [String(o.id), o]))

  // Compute goods sub-total per purchase order for proportional shipping allocation
  const goodsTotalByOrderId = new Map<string, number>()
  for (const row of purchaseItems) {
    const orderId = String(row.purchase_order_id || "")
    const qty = toNumber(row.quantity)
    const sub = toNumber(row.subtotal)
    const up = toNumber(row.unit_price)
    const amt = sub > 0 ? sub : qty * up
    goodsTotalByOrderId.set(orderId, (goodsTotalByOrderId.get(orderId) || 0) + amt)
  }

  const fifoBatchesByCode = new Map<string, FifoBatch[]>()
  for (const row of purchaseItems) {
    const code = normalizeCode(String(row.code || ""))
    if (!code || !codeSet.has(code)) continue
    const orderId = String(row.purchase_order_id || "")
    const order = purchaseOrderMap.get(orderId)
    if (!order) continue
    const qty = toNumber(row.quantity)
    if (qty <= 0) continue
    const sub = toNumber(row.subtotal)
    const up = toNumber(row.unit_price)
    const goodsAmt = sub > 0 ? sub : qty * up
    const goodsTotal = toNumber(goodsTotalByOrderId.get(orderId))
    const shippingFee = toNumber(order.shipping_fee)
    const allocatedShipping = goodsTotal > 0 ? (goodsAmt / goodsTotal) * shippingFee : 0
    const landedUnitCost = qty > 0 ? (goodsAmt + allocatedShipping) / qty : 0
    const batches = fifoBatchesByCode.get(code) ?? []
    batches.push({ orderedAt: String(order.order_date || ""), remainingQty: qty, landedUnitCost })
    fifoBatchesByCode.set(code, batches)
  }
  // Sort each code's FIFO queue oldest-first
  for (const batches of fifoBatchesByCode.values()) {
    batches.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt))
  }

  // latest_purchase_price = landed unit cost of most recent purchase batch
  const latestPurchasePriceByCode = new Map<string, number>()
  for (const [code, batches] of fifoBatchesByCode.entries()) {
    if (batches.length > 0) {
      latestPurchasePriceByCode.set(code, batches[batches.length - 1].landedUnitCost)
    }
  }

  // ── Step 2: Fetch ALL active sales items for these codes (all time) ───────────
  // We need all-time data so that sales before the report period correctly deplete
  // earlier purchase batches before we count the period's COGS.

  type SalesItemRow = { sales_order_id: string; code: string; quantity: number; subtotal: number; unit_price: number }
  const allSalesItems: SalesItemRow[] = []
  for (const chunk of chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase
      .from("sales_order_items")
      .select("sales_order_id,code,quantity,subtotal,unit_price")
      .in("code", chunk)
    if (result.error) {
      return {
        summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
        warning: result.error.message || "讀取銷貨明細失敗",
      }
    }
    allSalesItems.push(...(result.data || []))
  }

  const allSalesOrderIds = Array.from(new Set(allSalesItems.map((r) => String(r.sales_order_id || "")).filter(Boolean)))
  type SalesOrderRow = { id: string; order_date: string; status: string; total_amount: number }
  const allSalesOrders: SalesOrderRow[] = []
  for (const chunk of chunkArray(allSalesOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase.from("sales_orders").select("id,order_date,status,total_amount").in("id", chunk)
    if (result.error) {
      return {
        summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
        warning: result.error.message || "讀取銷貨單失敗",
      }
    }
    allSalesOrders.push(...(result.data || []))
  }

  const salesOrderMap = new Map(allSalesOrders.map((o) => [String(o.id), o]))

  // Attach order_date to each sale item, filter out cancelled
  type SalesItemWithDate = SalesItemRow & { order_date: string; order_total_amount: number }
  const activeSalesItems: SalesItemWithDate[] = allSalesItems
    .map((row) => {
      const order = salesOrderMap.get(String(row.sales_order_id || ""))
      if (!order || String(order.status || "").trim().toLowerCase() === "cancelled") return null
      return { ...row, order_date: String(order.order_date || ""), order_total_amount: toNumber(order.total_amount) }
    })
    .filter(Boolean) as SalesItemWithDate[]

  // Sort chronologically so FIFO depletion happens in the right order
  activeSalesItems.sort((a, b) => a.order_date.localeCompare(b.order_date))

  // ── Step 3: FIFO matching – iterate all time, count only period sales ─────────

  const summaryByCode = new Map<string, ProductProfitAnalysisSummary>()
  const trackedByOrderAndCode = new Map<string, Map<string, number>>()
  const orderItemTotalByOrder = new Map<string, number>()

  for (const row of activeSalesItems) {
    const code = normalizeCode(String(row.code || ""))
    if (!code || !codeSet.has(code)) continue
    const qty = toNumber(row.quantity)
    if (qty <= 0) continue
    const sub = toNumber(row.subtotal)
    const up = toNumber(row.unit_price)
    const salesAmt = sub > 0 ? sub : qty * up
    if (!Number.isFinite(salesAmt) || salesAmt <= 0) continue

    // Always consume FIFO queue (even for out-of-period sales) to keep ordering accurate
    const batches = fifoBatchesByCode.get(code) ?? []
    const fifoCogs = consumeFifo(batches, qty)

    if (!isInPeriod(row.order_date)) continue

    const salesOrderId = String(row.sales_order_id || "")
    orderItemTotalByOrder.set(salesOrderId, (orderItemTotalByOrder.get(salesOrderId) || 0) + salesAmt)

    const current = summaryByCode.get(code) ?? { sales_qty_total: 0, sales_amount_total: 0, cash_received_total: 0, fifo_cogs_total: 0, latest_purchase_price: latestPurchasePriceByCode.get(code) ?? 0 }
    current.sales_qty_total += qty
    current.sales_amount_total += salesAmt
    current.fifo_cogs_total += fifoCogs
    summaryByCode.set(code, current)

    const trackedByCode = trackedByOrderAndCode.get(salesOrderId) ?? new Map<string, number>()
    trackedByCode.set(code, (trackedByCode.get(code) || 0) + salesAmt)
    trackedByOrderAndCode.set(salesOrderId, trackedByCode)
  }

  // ── Step 4: Cash collection ratio → cash_received_total ──────────────────────

  const periodOrderIds = Array.from(trackedByOrderAndCode.keys())
  const receivableRows: { sales_order_id: string; paid_amount: number }[] = []
  for (const chunk of chunkArray(periodOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase.from("accounts_receivable").select("sales_order_id,paid_amount").in("sales_order_id", chunk)
    if (result.error) {
      warningMessages.push(result.error.message || "讀取 accounts_receivable 失敗")
      break
    }
    receivableRows.push(...(result.data || []))
  }

  const paidAmountByOrder = new Map<string, number>()
  for (const row of receivableRows) {
    const orderId = String(row.sales_order_id || "")
    paidAmountByOrder.set(orderId, (paidAmountByOrder.get(orderId) || 0) + toNumber(row.paid_amount))
  }

  for (const [salesOrderId, amountByCode] of trackedByOrderAndCode.entries()) {
    const order = salesOrderMap.get(salesOrderId)
    const headerTotal = toNumber(order?.total_amount)
    const itemsTotal = toNumber(orderItemTotalByOrder.get(salesOrderId))
    const orderTotal = headerTotal > 0 ? headerTotal : itemsTotal
    const paidAmount = Math.max(0, toNumber(paidAmountByOrder.get(salesOrderId)))
    const collectionRatio = orderTotal > 0 ? Math.min(1, paidAmount / orderTotal) : 0
    for (const [code, trackedAmt] of amountByCode.entries()) {
      const current = summaryByCode.get(code)
      if (current) current.cash_received_total += trackedAmt * collectionRatio
    }
  }

  // Ensure latest_purchase_price is set for all codes that have purchase data
  // (even if they have no sales in the queried period)
  for (const [code, latestPrice] of latestPurchasePriceByCode.entries()) {
    const current = summaryByCode.get(code)
    if (current) {
      current.latest_purchase_price = latestPrice
    }
  }

  return {
    summaryByCode,
    warning: warningMessages.length > 0 ? warningMessages.join("；") : null,
  }
}
