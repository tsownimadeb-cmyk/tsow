import type { Product as ProductType } from "@/lib/types"
import { isCompletedPurchaseStatus } from "@/lib/purchase-status"
import {
  calculateFifoSaleCosts,
  resolveFifoPurchaseUnitCost,
  type FifoPurchase,
  type FifoReturn,
  type FifoSale,
} from "@/lib/fifo-ledger"

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
  fifo_unknown_qty: number
  fifo_cost_complete: boolean
  latest_purchase_price: number
}

export type ProductListRowWithProfit = ProductListRow & {
  sales_qty_total: number
  sales_amount_total: number
  cogs_total: number
  fifo_cogs_total: number
  fifo_unknown_qty: number
  fifo_cost_complete: boolean
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

// Generic paginated fetch helper using Supabase .range(from,to)
async function fetchAllRows(
  supabase: any,
  table: string,
  selectText: string,
  opts?: { inColumn?: string; inValues?: any[]; pageSize?: number; orderBy?: { column: string; ascending?: boolean } },
) {
  const pageSize = opts?.pageSize ?? 1000
  const results: any[] = []
  const inColumn = opts?.inColumn
  const inValues = opts?.inValues

  // If caller provided an IN filter but it's empty, return empty
  if (inColumn && Array.isArray(inValues) && inValues.length === 0) return results

  // If we have IN values, we still need to split into chunks to avoid long IN lists
  if (inColumn && Array.isArray(inValues)) {
    const inChunks = chunkArray(inValues, IN_FILTER_CHUNK_SIZE)
    for (const chunk of inChunks) {
      let from = 0
      while (true) {
        let query = supabase.from(table).select(selectText)
        query = query.in(inColumn, chunk)
        if (opts?.orderBy) query = query.order(opts.orderBy.column, { ascending: !!opts.orderBy.ascending })
        const res = await query.range(from, from + pageSize - 1)
        if (res.error) throw new Error(res.error.message || `Query ${table} failed`)
        results.push(...(res.data || []))
        if (!res.data || res.data.length < pageSize) break
        from += pageSize
      }
    }
    return results
  }

  // No IN filter: fetch pages until less than pageSize
  let from = 0
  while (true) {
    let query = supabase.from(table).select(selectText)
    if (opts?.orderBy) query = query.order(opts.orderBy.column, { ascending: !!opts.orderBy.ascending })
    const res = await query.range(from, from + pageSize - 1)
    if (res.error) throw new Error(res.error.message || `Query ${table} failed`)
    results.push(...(res.data || []))
    if (!res.data || res.data.length < pageSize) break
    from += pageSize
  }

  return results
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

export async function fetchAllProductsRows(supabase: any) {
  const queryByPriority = [
    "code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,cost,price,sale_price,supplier_id,stock_qty,purchase_qty_total",
  ]

  for (const selectText of queryByPriority) {
    const result = await supabase.from("products").select(selectText).order("code", { ascending: true })
    if (!result.error) {
      return {
        rows: result.data || [],
        warning: null as string | null,
      }
    }
  }

  const finalAttempt = await supabase
    .from("products")
    .select("code,name,spec,unit,category,base_price,cost,price,sale_price,supplier_id")
    .order("code", { ascending: true })

  return {
    rows: finalAttempt.data || [],
    warning: finalAttempt.error?.message || "products 全量查詢失敗，已回退為基本欄位",
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
  try {
    const promised = chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "purchase_order_items", "purchase_order_id,code,quantity,subtotal,unit_price", {
        inColumn: "code",
        inValues: chunk,
        pageSize: 1000,
        orderBy: { column: "purchase_order_id", ascending: true },
      }),
    )
    const results = await Promise.all(promised)
    for (const rows of results) purchaseItems.push(...(rows || []))
  } catch (err: any) {
    warningMessages.push("讀取進貨明細失敗：" + (err?.message || String(err)))
  }

  const purchaseOrderIds = Array.from(new Set(purchaseItems.map((r) => String(r.purchase_order_id || "")).filter(Boolean)))
  type PurchaseOrderRow = { id: string; order_date: string; shipping_fee: number; total_amount?: number; status: string }
  const purchaseOrders: PurchaseOrderRow[] = []
  try {
    const promisedOrders = chunkArray(purchaseOrderIds, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "purchase_orders", "id,order_date,shipping_fee,total_amount,status", {
        inColumn: "id",
        inValues: chunk,
        pageSize: 1000,
        orderBy: { column: "order_date", ascending: true },
      }),
    )
    const orderResults = await Promise.all(promisedOrders)
    for (const rows of orderResults) purchaseOrders.push(...(rows || []))
  } catch (err: any) {
    warningMessages.push("讀取進貨單失敗：" + (err?.message || String(err)))
  }

  const purchaseOrderMap = new Map(purchaseOrders.map((o) => [String(o.id), o]))

  const purchaseCostOverrideByOrderAndCode = new Map<string, number>()
  try {
    const promisedOverrides = chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "fifo_purchase_cost_overrides", "purchase_order_id,product_code,unit_cost", {
        inColumn: "product_code",
        inValues: chunk,
        pageSize: 1000,
      }),
    )
    const overrideResults = await Promise.all(promisedOverrides)
    for (const rows of overrideResults) {
      for (const row of rows || []) {
        const code = normalizeCode(row.product_code)
        const orderId = String(row.purchase_order_id || "")
        if (code && orderId) {
          purchaseCostOverrideByOrderAndCode.set(`${orderId}::${code}`, toNumber(row.unit_cost))
        }
      }
    }
  } catch (err: any) {
    warningMessages.push(err?.message || "無法讀取 FIFO 進貨成本校正資料")
  }

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

  const purchaseBatchesByCode = new Map<string, FifoPurchase[]>()
  for (const row of purchaseItems) {
    const code = normalizeCode(String(row.code || ""))
    if (!code || !codeSet.has(code)) continue
    const orderId = String(row.purchase_order_id || "")
    const order = purchaseOrderMap.get(orderId)
    if (!order || !isCompletedPurchaseStatus(order.status)) continue
    const qty = toNumber(row.quantity)
    if (qty <= 0) continue
    const sub = toNumber(row.subtotal)
    const up = toNumber(row.unit_price)
    const goodsAmt = sub > 0 ? sub : qty * up
    const goodsTotal = toNumber(goodsTotalByOrderId.get(orderId))
    const shippingFee = toNumber(order.shipping_fee)
    const orderTotalAmount = toNumber((order as any).total_amount)
    const fallbackGoodsTotal = goodsTotal
    const allocationBase = orderTotalAmount > 0 ? orderTotalAmount : fallbackGoodsTotal
    const allocatedShipping = allocationBase > 0 ? (goodsAmt / allocationBase) * shippingFee : 0
    const calculatedUnitCost = qty > 0 ? (goodsAmt + allocatedShipping) / qty : 0
    const landedUnitCost = resolveFifoPurchaseUnitCost(
      calculatedUnitCost,
      purchaseCostOverrideByOrderAndCode.get(`${orderId}::${code}`),
    )
    const batches = purchaseBatchesByCode.get(code) ?? []
    batches.push({ orderedAt: String(order.order_date || ""), quantity: qty, unitCost: landedUnitCost })
    purchaseBatchesByCode.set(code, batches)
  }
  // Sort each code's FIFO queue oldest-first
  for (const batches of purchaseBatchesByCode.values()) {
    batches.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt))
  }

  // latest_purchase_price = landed unit cost of most recent purchase batch
  const latestPurchasePriceByCode = new Map<string, number>()
  for (const [code, batches] of purchaseBatchesByCode.entries()) {
    if (batches.length > 0) {
      latestPurchasePriceByCode.set(code, batches[batches.length - 1].unitCost)
    }
  }

  // ── Step 2: Fetch ALL active sales items for these codes (all time) ───────────
  // We need all-time data so that sales before the report period correctly deplete
  // earlier purchase batches before we count the period's COGS.

  type SalesItemRow = { sales_order_id: string; code: string; quantity: number; subtotal: number; unit_price: number }
  const allSalesItems: SalesItemRow[] = []
  try {
    const promised = chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "sales_order_items", "sales_order_id,code,quantity,subtotal,unit_price", {
        inColumn: "code",
        inValues: chunk,
        pageSize: 1000,
        orderBy: { column: "sales_order_id", ascending: true },
      }),
    )
    const results = await Promise.all(promised)
    for (const rows of results) allSalesItems.push(...(rows || []))
  } catch (err: any) {
    return {
      summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
      warning: err?.message || "讀取銷貨明細失敗",
    }
  }

  const allSalesOrderIds = Array.from(new Set(allSalesItems.map((r) => String(r.sales_order_id || "")).filter(Boolean)))
  type SalesOrderRow = { id: string; order_date: string; status: string; total_amount: number }
  const allSalesOrders: SalesOrderRow[] = []
  try {
    const promisedOrders = chunkArray(allSalesOrderIds, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "sales_orders", "id,order_date,status,total_amount", {
        inColumn: "id",
        inValues: chunk,
        pageSize: 1000,
        orderBy: { column: "order_date", ascending: true },
      }),
    )
    const orderResults = await Promise.all(promisedOrders)
    for (const rows of orderResults) allSalesOrders.push(...(rows || []))
  } catch (err: any) {
    return {
      summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
      warning: err?.message || "讀取銷貨單失敗",
    }
  }

  const salesOrderMap = new Map(allSalesOrders.map((o) => [String(o.id), o]))

  // Attach order_date to each sale item, only keep completed sales
  type SalesItemWithDate = SalesItemRow & { order_date: string; order_total_amount: number; fifo_event_id: string }
  const activeSalesItems: SalesItemWithDate[] = allSalesItems
    .map((row, index) => {
      const order = salesOrderMap.get(String(row.sales_order_id || ""))
      if (!order || String(order.status || "").trim().toLowerCase() !== "completed") return null
      return {
        ...row,
        order_date: String(order.order_date || ""),
        order_total_amount: toNumber(order.total_amount),
        fifo_event_id: `${String(row.sales_order_id || "")}::${normalizeCode(row.code)}::${index}`,
      }
    })
    .filter(Boolean) as SalesItemWithDate[]

  // Sort chronologically so FIFO depletion happens in the right order
  activeSalesItems.sort((a, b) => a.order_date.localeCompare(b.order_date))
  const saleEventIdByOrderAndCode = new Map<string, string>()
  for (const row of activeSalesItems) {
    const key = `${String(row.sales_order_id || "")}::${normalizeCode(row.code)}`
    if (!saleEventIdByOrderAndCode.has(key)) saleEventIdByOrderAndCode.set(key, row.fifo_event_id)
  }

  // Use a confirmed opening FIFO balance when available. Otherwise infer the
  // quantity that existed before transaction history began and leave its cost
  // unresolved so later purchase batches stay in the correct FIFO position.
  const stockQtyByCode = new Map<string, number>()
  const openingBalanceByCode = new Map<string, { quantity: number; unitCost: number }>()
  const movementHistoryUncertainCodes = new Set<string>()
  type SalesReturnItemWithDate = {
    fifo_event_id: string
    original_sale_event_id: string
    product_code: string
    quantity: number
    unit_price: number
    amount: number
    return_date: string
  }
  const activeSalesReturnItems: SalesReturnItemWithDate[] = []
  try {
    const stockRows = await fetchAllRows(supabase, "products", "code,stock_qty", {
      inColumn: "code",
      inValues: normalizedCodes,
      pageSize: 1000,
      orderBy: { column: "code", ascending: true },
    })
    for (const row of stockRows) {
      const code = normalizeCode(row.code)
      if (code) stockQtyByCode.set(code, toNumber(row.stock_qty))
    }

    const [openingBalances, adjustments, purchaseReturnItems, salesReturns, salesReturnItems] = await Promise.all([
      fetchAllRows(supabase, "fifo_opening_balances", "product_code,quantity,unit_cost", {
        pageSize: 1000,
      }),
      fetchAllRows(supabase, "stock_adjustments", "id,product_code,adjustment_qty,fifo_resolution,fifo_unit_cost", {
        pageSize: 1000,
      }),
      fetchAllRows(supabase, "purchase_return_items", "product_code,product_id", {
        pageSize: 1000,
      }),
      fetchAllRows(supabase, "sales_returns", "id,sales_order_id,return_date", {
        pageSize: 1000,
      }),
      fetchAllRows(supabase, "sales_return_items", "id,sales_return_id,product_code,product_id,quantity,unit_price,amount", {
        pageSize: 1000,
      }),
    ])

    for (const row of openingBalances) {
      const code = normalizeCode(row.product_code)
      const quantity = toNumber(row.quantity)
      const unitCost = toNumber(row.unit_cost)
      if (code && quantity > 0 && unitCost > 0) openingBalanceByCode.set(code, { quantity, unitCost })
    }

    for (const row of adjustments) {
      const code = normalizeCode(row.product_code)
      const isResolvedOpening =
        String(row.fifo_resolution || "") === "opening_balance" &&
        toNumber(row.adjustment_qty) > 0 &&
        toNumber(row.fifo_unit_cost) > 0 &&
        openingBalanceByCode.has(code)
      if (codeSet.has(code) && !isResolvedOpening) movementHistoryUncertainCodes.add(code)
    }
    for (const row of purchaseReturnItems) {
      const code = normalizeCode(row.product_code || row.product_id)
      if (codeSet.has(code)) movementHistoryUncertainCodes.add(code)
    }

    const salesReturnMap = new Map(salesReturns.map((row) => [String(row.id || ""), row]))
    for (const row of salesReturnItems) {
      const code = normalizeCode(row.product_code || row.product_id)
      if (!code || !codeSet.has(code)) continue
      const header = salesReturnMap.get(String(row.sales_return_id || ""))
      const originalSaleEventId = saleEventIdByOrderAndCode.get(`${String(header?.sales_order_id || "")}::${code}`)
      const quantity = toNumber(row.quantity)
      if (!header || !originalSaleEventId || quantity <= 0) {
        movementHistoryUncertainCodes.add(code)
        continue
      }
      activeSalesReturnItems.push({
        fifo_event_id: `sales-return:${String(row.id || "")}`,
        original_sale_event_id: originalSaleEventId,
        product_code: code,
        quantity,
        unit_price: toNumber(row.unit_price),
        amount: toNumber(row.amount),
        return_date: String(header.return_date || ""),
      })
    }
  } catch (err: any) {
    for (const code of normalizedCodes) movementHistoryUncertainCodes.add(code)
    warningMessages.push(err?.message || "無法核對退貨或庫存調整資料")
  }

  const totalPurchasedQtyByCode = new Map<string, number>()
  for (const [code, batches] of purchaseBatchesByCode.entries()) {
    totalPurchasedQtyByCode.set(code, batches.reduce((sum, batch) => sum + toNumber(batch.quantity), 0))
  }

  const totalSalesQtyByCode = new Map<string, number>()
  const totalSalesReturnQtyByCode = new Map<string, number>()
  const salesEventsByCode = new Map<string, FifoSale[]>()
  const salesReturnEventsByCode = new Map<string, FifoReturn[]>()
  for (const row of activeSalesItems) {
    const code = normalizeCode(row.code)
    const qty = toNumber(row.quantity)
    if (!code || qty <= 0) continue
    totalSalesQtyByCode.set(code, (totalSalesQtyByCode.get(code) || 0) + qty)
    const events = salesEventsByCode.get(code) ?? []
    events.push({ id: row.fifo_event_id, orderedAt: row.order_date, quantity: qty })
    salesEventsByCode.set(code, events)
  }
  for (const row of activeSalesReturnItems) {
    const code = normalizeCode(row.product_code)
    totalSalesReturnQtyByCode.set(code, (totalSalesReturnQtyByCode.get(code) || 0) + row.quantity)
    const events = salesReturnEventsByCode.get(code) ?? []
    events.push({
      id: row.fifo_event_id,
      originalSaleId: row.original_sale_event_id,
      orderedAt: row.return_date,
      quantity: row.quantity,
    })
    salesReturnEventsByCode.set(code, events)
  }

  const fifoCostByEventId = new Map<string, { cogs: number; unknownQty: number }>()
  for (const code of normalizedCodes) {
    const canInferOpening = !movementHistoryUncertainCodes.has(code) && stockQtyByCode.has(code)
    const confirmedOpening = openingBalanceByCode.get(code)
    const inferredOpeningQty = canInferOpening
      ? Math.max(
          0,
          toNumber(stockQtyByCode.get(code)) +
            toNumber(totalSalesQtyByCode.get(code)) -
            toNumber(totalPurchasedQtyByCode.get(code)) -
            toNumber(totalSalesReturnQtyByCode.get(code)),
        )
      : 0
    const openingQty = confirmedOpening?.quantity ?? inferredOpeningQty
    const costs = calculateFifoSaleCosts({
      openingQty,
      openingUnitCost: confirmedOpening?.unitCost ?? null,
      purchases: purchaseBatchesByCode.get(code) ?? [],
      sales: salesEventsByCode.get(code) ?? [],
      returns: salesReturnEventsByCode.get(code) ?? [],
    })
    for (const [eventId, cost] of costs.entries()) fifoCostByEventId.set(eventId, cost)
  }

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

    const fifoCost = fifoCostByEventId.get(row.fifo_event_id) ?? { cogs: 0, unknownQty: qty }

    if (!Number.isFinite(salesAmt) || salesAmt <= 0) continue

    if (!isInPeriod(row.order_date)) continue

    const salesOrderId = String(row.sales_order_id || "")
    orderItemTotalByOrder.set(salesOrderId, (orderItemTotalByOrder.get(salesOrderId) || 0) + salesAmt)

    const current = summaryByCode.get(code) ?? {
      sales_qty_total: 0,
      sales_amount_total: 0,
      cash_received_total: 0,
      fifo_cogs_total: 0,
      fifo_unknown_qty: 0,
      fifo_cost_complete: !movementHistoryUncertainCodes.has(code),
      latest_purchase_price: latestPurchasePriceByCode.get(code) ?? 0,
    }
    current.sales_qty_total += qty
    current.sales_amount_total += salesAmt
    current.fifo_cogs_total += fifoCost.cogs
    current.fifo_unknown_qty += fifoCost.unknownQty
    current.fifo_cost_complete = current.fifo_cost_complete && fifoCost.unknownQty <= 0
    summaryByCode.set(code, current)

    const trackedByCode = trackedByOrderAndCode.get(salesOrderId) ?? new Map<string, number>()
    trackedByCode.set(code, (trackedByCode.get(code) || 0) + salesAmt)
    trackedByOrderAndCode.set(salesOrderId, trackedByCode)
  }

  for (const row of activeSalesReturnItems) {
    const code = normalizeCode(row.product_code)
    if (!code || !isInPeriod(row.return_date)) continue
    const returnAmount = row.amount > 0 ? row.amount : row.quantity * row.unit_price
    const fifoCost = fifoCostByEventId.get(row.fifo_event_id) ?? { cogs: 0, unknownQty: row.quantity }
    const current = summaryByCode.get(code) ?? {
      sales_qty_total: 0,
      sales_amount_total: 0,
      cash_received_total: 0,
      fifo_cogs_total: 0,
      fifo_unknown_qty: 0,
      fifo_cost_complete: !movementHistoryUncertainCodes.has(code),
      latest_purchase_price: latestPurchasePriceByCode.get(code) ?? 0,
    }
    current.sales_qty_total -= row.quantity
    current.sales_amount_total -= returnAmount
    current.fifo_cogs_total -= fifoCost.cogs
    current.fifo_unknown_qty += fifoCost.unknownQty
    current.fifo_cost_complete = current.fifo_cost_complete && fifoCost.unknownQty <= 0
    summaryByCode.set(code, current)
  }

  // ── Step 4: Cash collection ratio → cash_received_total ──────────────────────

  const periodOrderIds = Array.from(trackedByOrderAndCode.keys())
  const receivableRows: { sales_order_id: string; paid_amount: number }[] = []
  try {
    const promised = chunkArray(periodOrderIds, IN_FILTER_CHUNK_SIZE).map((chunk) =>
      fetchAllRows(supabase, "accounts_receivable", "sales_order_id,paid_amount", {
        inColumn: "sales_order_id",
        inValues: chunk,
        pageSize: 1000,
        orderBy: { column: "sales_order_id", ascending: true },
      }),
    )
    const results = await Promise.all(promised)
    for (const rows of results) receivableRows.push(...(rows || []))
  } catch (err: any) {
    warningMessages.push(err?.message || "讀取 accounts_receivable 失敗")
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
