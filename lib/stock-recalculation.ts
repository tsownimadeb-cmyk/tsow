type SupabaseLikeClient = {
  from: (table: string) => any
}

export type StockProductRow = {
  code: unknown
}

export type StockOrderRow = {
  id: unknown
  order_no?: unknown
  status: unknown
}

export type PurchaseStockItemRow = {
  id?: unknown
  purchase_order_id: unknown
  order_no?: unknown
  code: unknown
  quantity: unknown
}

export type SalesStockItemRow = {
  id?: unknown
  sales_order_id: unknown
  code: unknown
  quantity: unknown
}

export type StockReturnRow = {
  id: unknown
  status: unknown
}

export type PurchaseReturnStockItemRow = {
  id?: unknown
  purchase_return_id: unknown
  product_id: unknown
  quantity: unknown
}

export type SalesReturnStockItemRow = {
  id?: unknown
  sales_return_id: unknown
  product_code: unknown
  quantity: unknown
}

export type ProductStockUpdate = {
  code: string
  stock_qty: number
  purchase_qty_total: number
}

export type StockRecalculationStats = {
  products: number
  completedPurchaseItems: number
  completedSalesItems: number
  completedPurchaseReturnItems: number
  completedSalesReturnItems: number
}

export type StockRecalculationInput = {
  products: StockProductRow[]
  purchaseOrders: StockOrderRow[]
  purchaseItems: PurchaseStockItemRow[]
  salesOrders: StockOrderRow[]
  salesItems: SalesStockItemRow[]
  purchaseReturns: StockReturnRow[]
  purchaseReturnItems: PurchaseReturnStockItemRow[]
  salesReturns: StockReturnRow[]
  salesReturnItems: SalesReturnStockItemRow[]
}

export type FetchAllRowsOptions = {
  table: string
  select: string
  orderBy: string
  label: string
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 1000
const COMPLETED_STATUS = "completed"

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase()
}

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim()
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

function itemDescription(table: string, id: unknown): string {
  const normalizedId = normalizeKey(id)
  return normalizedId ? `${table}（id: ${normalizedId}）` : table
}

function requirePositiveQuantity(value: unknown, description: string): number {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${description} 的數量必須是大於 0 的有效數字`)
  }
  return quantity
}

function addQuantity(target: Map<string, number>, code: string, quantity: number) {
  target.set(code, (target.get(code) ?? 0) + quantity)
}

function createStatusMap(rows: StockOrderRow[] | StockReturnRow[], table: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const row of rows) {
    const id = normalizeKey(row.id)
    if (!id) {
      throw new Error(`${table} 存在缺少 id 的資料，已停止重算`)
    }
    if (result.has(id)) {
      throw new Error(`${table} 存在重複 id「${id}」，已停止重算`)
    }
    result.set(id, normalizeStatus(row.status))
  }
  return result
}

function requireKnownProductCode(
  rawCode: unknown,
  productByNormalizedCode: Map<string, string>,
  description: string,
): string {
  const code = normalizeCode(rawCode)
  if (!code) {
    throw new Error(`${description} 缺少商品代號，已停止重算`)
  }
  if (!productByNormalizedCode.has(code)) {
    throw new Error(`${description} 參照不存在的商品「${String(rawCode ?? "").trim()}」，已停止重算`)
  }
  return code
}

/**
 * Fetches every row despite PostgREST's per-request row cap.
 *
 * An exact count is checked on every page. If the source table changes while it
 * is being read, the recalculation is aborted instead of applying a mixed
 * snapshot silently.
 */
export async function fetchAllRows<T>(
  supabase: SupabaseLikeClient,
  options: FetchAllRowsOptions,
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("分頁大小必須是正整數")
  }

  const rows: T[] = []
  let offset = 0
  let expectedCount: number | null = null

  while (true) {
    const response = await supabase
      .from(options.table)
      .select(options.select, { count: "exact" })
      .order(options.orderBy, { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (response.error) {
      throw new Error(`${options.label}失敗：${response.error.message || "未知錯誤"}`)
    }
    if (!Array.isArray(response.data)) {
      throw new Error(`${options.label}失敗：資料格式不正確`)
    }

    const responseCount = typeof response.count === "number" ? response.count : null
    if (expectedCount === null && responseCount !== null) {
      expectedCount = responseCount
    } else if (expectedCount !== null && responseCount !== null && responseCount !== expectedCount) {
      throw new Error(`${options.label}期間資料筆數發生變動，請稍後重試`)
    }

    rows.push(...(response.data as T[]))

    if (response.data.length === 0) break
    offset += response.data.length

    if (expectedCount !== null && rows.length >= expectedCount) break
  }

  if (expectedCount !== null && rows.length !== expectedCount) {
    throw new Error(`${options.label}失敗：預期 ${expectedCount} 筆，實際讀到 ${rows.length} 筆`)
  }

  return rows
}

/**
 * Calculates inventory from completed business documents only:
 * completed purchases - completed sales - completed purchase returns
 * + completed sales returns.
 *
 * purchase_qty_total remains the gross quantity from completed purchases,
 * matching the field's existing "total purchased" meaning.
 */
export function calculateProductStock(input: StockRecalculationInput): {
  updates: ProductStockUpdate[]
  stats: StockRecalculationStats
} {
  const productByNormalizedCode = new Map<string, string>()
  for (const product of input.products) {
    // Keep the exact persisted value for the eventual conflict key. Trimming is
    // only used for comparisons; changing the key itself could insert a second
    // product instead of updating a legacy code that contains whitespace.
    const persistedCode = String(product.code ?? "")
    const displayCode = normalizeKey(product.code)
    const normalizedCode = normalizeCode(product.code)
    if (!normalizedCode) {
      throw new Error("products 存在缺少商品代號的資料，已停止重算")
    }
    const duplicate = productByNormalizedCode.get(normalizedCode)
    if (duplicate !== undefined) {
      throw new Error(`商品代號「${displayCode}」與「${duplicate.trim()}」忽略大小寫後重複，已停止重算`)
    }
    productByNormalizedCode.set(normalizedCode, persistedCode)
  }

  const purchaseStatusById = createStatusMap(input.purchaseOrders, "purchase_orders")
  const purchaseStatusByOrderNo = new Map<string, string>()
  for (const order of input.purchaseOrders) {
    const orderNo = normalizeKey(order.order_no)
    if (!orderNo) continue
    const status = normalizeStatus(order.status)
    const existing = purchaseStatusByOrderNo.get(orderNo)
    if (existing !== undefined && existing !== status) {
      throw new Error(`purchase_orders 單號「${orderNo}」重複且狀態不一致，已停止重算`)
    }
    purchaseStatusByOrderNo.set(orderNo, status)
  }
  const salesStatusById = createStatusMap(input.salesOrders, "sales_orders")
  const purchaseReturnStatusById = createStatusMap(input.purchaseReturns, "purchase_returns")
  const salesReturnStatusById = createStatusMap(input.salesReturns, "sales_returns")

  const purchased = new Map<string, number>()
  const sold = new Map<string, number>()
  const returnedToSupplier = new Map<string, number>()
  const returnedByCustomer = new Map<string, number>()
  const stats: StockRecalculationStats = {
    products: input.products.length,
    completedPurchaseItems: 0,
    completedSalesItems: 0,
    completedPurchaseReturnItems: 0,
    completedSalesReturnItems: 0,
  }

  for (const item of input.purchaseItems) {
    const description = itemDescription("purchase_order_items", item.id)
    const orderId = normalizeKey(item.purchase_order_id)
    const orderNo = normalizeKey(item.order_no)
    let status: string | undefined

    if (orderId) {
      status = purchaseStatusById.get(orderId)
      if (status === undefined) {
        throw new Error(`${description} 參照不存在的進貨單 id「${orderId}」，已停止重算`)
      }
    } else if (orderNo) {
      status = purchaseStatusByOrderNo.get(orderNo)
      if (status === undefined) {
        throw new Error(`${description} 參照不存在的進貨單號「${orderNo}」，已停止重算`)
      }
    } else {
      throw new Error(`${description} 缺少進貨單關聯，已停止重算`)
    }

    if (status !== COMPLETED_STATUS) continue
    const code = requireKnownProductCode(item.code, productByNormalizedCode, description)
    addQuantity(purchased, code, requirePositiveQuantity(item.quantity, description))
    stats.completedPurchaseItems += 1
  }

  for (const item of input.salesItems) {
    const description = itemDescription("sales_order_items", item.id)
    const orderId = normalizeKey(item.sales_order_id)
    if (!orderId) {
      throw new Error(`${description} 缺少銷貨單關聯，已停止重算`)
    }
    const status = salesStatusById.get(orderId)
    if (status === undefined) {
      throw new Error(`${description} 參照不存在的銷貨單 id「${orderId}」，已停止重算`)
    }
    if (status !== COMPLETED_STATUS) continue

    const code = requireKnownProductCode(item.code, productByNormalizedCode, description)
    addQuantity(sold, code, requirePositiveQuantity(item.quantity, description))
    stats.completedSalesItems += 1
  }

  for (const item of input.purchaseReturnItems) {
    const description = itemDescription("purchase_return_items", item.id)
    const returnId = normalizeKey(item.purchase_return_id)
    if (!returnId) {
      throw new Error(`${description} 缺少進貨退回單關聯，已停止重算`)
    }
    const status = purchaseReturnStatusById.get(returnId)
    if (status === undefined) {
      throw new Error(`${description} 參照不存在的進貨退回單 id「${returnId}」，已停止重算`)
    }
    if (status !== COMPLETED_STATUS) continue

    const code = requireKnownProductCode(item.product_id, productByNormalizedCode, description)
    addQuantity(returnedToSupplier, code, requirePositiveQuantity(item.quantity, description))
    stats.completedPurchaseReturnItems += 1
  }

  for (const item of input.salesReturnItems) {
    const description = itemDescription("sales_return_items", item.id)
    const returnId = normalizeKey(item.sales_return_id)
    if (!returnId) {
      throw new Error(`${description} 缺少銷貨退回單關聯，已停止重算`)
    }
    const status = salesReturnStatusById.get(returnId)
    if (status === undefined) {
      throw new Error(`${description} 參照不存在的銷貨退回單 id「${returnId}」，已停止重算`)
    }
    if (status !== COMPLETED_STATUS) continue

    const code = requireKnownProductCode(item.product_code, productByNormalizedCode, description)
    addQuantity(returnedByCustomer, code, requirePositiveQuantity(item.quantity, description))
    stats.completedSalesReturnItems += 1
  }

  const updates = Array.from(productByNormalizedCode.entries())
    .map(([normalizedCode, originalCode]) => {
      const purchaseQty = purchased.get(normalizedCode) ?? 0
      const stockQty =
        purchaseQty -
        (sold.get(normalizedCode) ?? 0) -
        (returnedToSupplier.get(normalizedCode) ?? 0) +
        (returnedByCustomer.get(normalizedCode) ?? 0)

      return {
        code: originalCode,
        stock_qty: stockQty,
        purchase_qty_total: purchaseQty,
      }
    })
    .sort((left, right) => left.code.localeCompare(right.code))

  return { updates, stats }
}
