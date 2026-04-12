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
}

type SalesOrderAnalysisRow = {
  id: string | null
  status: string | null
  order_date: string | null
  total_amount: number | string | null
}

type SalesItemSummaryRow = {
  sales_order_id: string | null
  code: string | null
  quantity: number | string | null
  subtotal: number | string | null
  unit_price: number | string | null
}

type AccountsReceivablePaidRow = {
  sales_order_id: string | null
  paid_amount: number | string | null
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
  const hasValidDateText = (value: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
  const startDate = hasValidDateText(options?.startDate) ? String(options?.startDate) : undefined
  const endDate = hasValidDateText(options?.endDate) ? String(options?.endDate) : undefined

  let salesOrdersQuery = supabase
    .from("sales_orders")
    .select("id,status,order_date,total_amount")

  if (startDate) {
    salesOrdersQuery = salesOrdersQuery.gte("order_date", startDate)
  }
  if (endDate) {
    salesOrdersQuery = salesOrdersQuery.lte("order_date", endDate)
  }

  const salesOrdersResult = await salesOrdersQuery
  if (salesOrdersResult.error) {
    return {
      summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
      warning: salesOrdersResult.error.message || "讀取 sales_orders 失敗",
    }
  }

  const salesOrders = (salesOrdersResult.data || []) as SalesOrderAnalysisRow[]
  const activeOrderMap = new Map<string, { total_amount: number }>()
  const activeOrderIds = salesOrders
    .filter((row) => String(row.status || "").trim().toLowerCase() !== "cancelled")
    .map((row) => {
      const orderId = String(row.id || "").trim()
      if (orderId) {
        activeOrderMap.set(orderId, {
          total_amount: toNumber(row.total_amount),
        })
      }
      return orderId
    })
    .filter(Boolean)

  if (activeOrderIds.length === 0) {
    return { summaryByCode: new Map<string, ProductProfitAnalysisSummary>(), warning: null }
  }

  const salesItems: SalesItemSummaryRow[] = []
  for (const orderIdChunk of chunkArray(activeOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const salesItemsResult = await supabase
      .from("sales_order_items")
      .select("sales_order_id,code,quantity,subtotal,unit_price")
      .in("sales_order_id", orderIdChunk)

    if (salesItemsResult.error) {
      return {
        summaryByCode: new Map<string, ProductProfitAnalysisSummary>(),
        warning: salesItemsResult.error.message || "讀取 sales_order_items 失敗",
      }
    }

    salesItems.push(...((salesItemsResult.data || []) as SalesItemSummaryRow[]))
  }

  const receivableRows: AccountsReceivablePaidRow[] = []
  for (const orderIdChunk of chunkArray(activeOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const receivableResult = await supabase
      .from("accounts_receivable")
      .select("sales_order_id,paid_amount")
      .in("sales_order_id", orderIdChunk)

    if (receivableResult.error) {
      warningMessages.push(receivableResult.error.message || "讀取 accounts_receivable 失敗")
      break
    }

    receivableRows.push(...((receivableResult.data || []) as AccountsReceivablePaidRow[]))
  }

  const summaryByCode = new Map<string, ProductProfitAnalysisSummary>()
  const trackedAmountByOrderAndCode = new Map<string, Map<string, number>>()
  const orderItemTotalByOrder = new Map<string, number>()

  for (const row of salesItems) {
    const salesOrderId = String(row.sales_order_id || "").trim()
    if (!salesOrderId) continue

    const code = normalizeCode(row.code)

    const quantity = toNumber(row.quantity)
    if (quantity <= 0) continue

    const subtotal = toNumber(row.subtotal)
    const unitPrice = toNumber(row.unit_price)
    const salesAmount = subtotal > 0 ? subtotal : quantity * unitPrice

    if (!Number.isFinite(salesAmount) || salesAmount <= 0) continue

    orderItemTotalByOrder.set(salesOrderId, (orderItemTotalByOrder.get(salesOrderId) || 0) + salesAmount)

    if (!code || !codeSet.has(code)) continue

    const current = summaryByCode.get(code) || { sales_qty_total: 0, sales_amount_total: 0, cash_received_total: 0 }
    current.sales_qty_total += quantity
    current.sales_amount_total += salesAmount
    summaryByCode.set(code, current)

    const trackedByCode = trackedAmountByOrderAndCode.get(salesOrderId) || new Map<string, number>()
    trackedByCode.set(code, (trackedByCode.get(code) || 0) + salesAmount)
    trackedAmountByOrderAndCode.set(salesOrderId, trackedByCode)
  }

  const paidAmountByOrder = new Map<string, number>()
  for (const row of receivableRows) {
    const salesOrderId = String(row.sales_order_id || "").trim()
    if (!salesOrderId) continue
    paidAmountByOrder.set(salesOrderId, (paidAmountByOrder.get(salesOrderId) || 0) + toNumber(row.paid_amount))
  }

  for (const [salesOrderId, amountByCode] of trackedAmountByOrderAndCode.entries()) {
    const orderHeaderTotal = toNumber(activeOrderMap.get(salesOrderId)?.total_amount)
    const orderItemsTotal = toNumber(orderItemTotalByOrder.get(salesOrderId))
    const orderTotal = orderHeaderTotal > 0 ? orderHeaderTotal : orderItemsTotal
    const paidAmount = Math.max(0, toNumber(paidAmountByOrder.get(salesOrderId)))
    const collectionRatio = orderTotal > 0 ? Math.min(1, paidAmount / orderTotal) : 0

    for (const [code, trackedAmount] of amountByCode.entries()) {
      const current = summaryByCode.get(code) || { sales_qty_total: 0, sales_amount_total: 0, cash_received_total: 0 }
      current.cash_received_total += trackedAmount * collectionRatio
      summaryByCode.set(code, current)
    }
  }

  return {
    summaryByCode,
    warning: warningMessages.length > 0 ? warningMessages.join("；") : null,
  }
}
