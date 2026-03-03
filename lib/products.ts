import type { Product as ProductType } from "@/lib/types"

export type ProductListRow = Pick<
  ProductType,
  "code" | "name" | "spec" | "unit" | "category" | "base_price" | "purchase_price" | "cost" | "price" | "sale_price"
> & {
  stock_qty: number
  purchase_qty_total: number
  safety_stock: number
}

export interface ProductProfitSummary {
  sales_qty_total: number
  sales_amount_total: number
}

export type ProductListRowWithProfit = ProductListRow & {
  sales_qty_total: number
  sales_amount_total: number
  cogs_total: number
  gross_profit: number
  gross_margin: number
}

type SalesOrderStatusRow = {
  id: string | null
  status: string | null
}

type SalesItemSummaryRow = {
  sales_order_id: string | null
  code: string | null
  quantity: number | string | null
  subtotal: number | string | null
  unit_price: number | string | null
}

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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
    stock_qty: Number(row.stock_qty ?? 0),
    purchase_qty_total: Number(row.purchase_qty_total ?? 0),
    safety_stock: Number(row.safety_stock ?? 0),
  }))
}

export async function fetchProductsRows(supabase: any) {
  const queryByPriority = [
    "code,name,spec,unit,category,base_price,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,base_price,cost,price,sale_price,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,purchase_price,cost,price,sale_price,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total",
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
    .select("code,name,spec,unit,category,base_price,cost,price,sale_price")
    .order("code", { ascending: true })

  return {
    rows: finalAttempt.data || [],
    warning: finalAttempt.error?.message || "products 查詢失敗，已回退為基本欄位",
  }
}

export async function fetchProductProfitSummaryByCode(
  supabase: any,
  productCodes: string[],
): Promise<{ summaryByCode: Map<string, ProductProfitSummary>; warning: string | null }> {
  const normalizedCodes = Array.from(new Set(productCodes.map((code) => normalizeCode(code)).filter(Boolean)))
  const codeSet = new Set(normalizedCodes)

  if (normalizedCodes.length === 0) {
    return { summaryByCode: new Map<string, ProductProfitSummary>(), warning: null }
  }

  const salesOrdersResult = await supabase.from("sales_orders").select("id,status")
  if (salesOrdersResult.error) {
    return {
      summaryByCode: new Map<string, ProductProfitSummary>(),
      warning: salesOrdersResult.error.message || "讀取 sales_orders 失敗",
    }
  }

  const salesOrders = (salesOrdersResult.data || []) as SalesOrderStatusRow[]
  const activeOrderIds = salesOrders
    .filter((row) => String(row.status || "").trim().toLowerCase() !== "cancelled")
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)

  if (activeOrderIds.length === 0) {
    return { summaryByCode: new Map<string, ProductProfitSummary>(), warning: null }
  }

  const salesItemsResult = await supabase
    .from("sales_order_items")
    .select("sales_order_id,code,quantity,subtotal,unit_price")
    .in("sales_order_id", activeOrderIds)

  if (salesItemsResult.error) {
    return {
      summaryByCode: new Map<string, ProductProfitSummary>(),
      warning: salesItemsResult.error.message || "讀取 sales_order_items 失敗",
    }
  }

  const summaryByCode = new Map<string, ProductProfitSummary>()
  const salesItems = (salesItemsResult.data || []) as SalesItemSummaryRow[]

  for (const row of salesItems) {
    const code = normalizeCode(row.code)
    if (!code || !codeSet.has(code)) continue

    const quantity = toNumber(row.quantity)
    if (quantity <= 0) continue

    const subtotal = toNumber(row.subtotal)
    const unitPrice = toNumber(row.unit_price)
    const salesAmount = subtotal > 0 ? subtotal : quantity * unitPrice

    const current = summaryByCode.get(code) || { sales_qty_total: 0, sales_amount_total: 0 }
    current.sales_qty_total += quantity
    current.sales_amount_total += salesAmount
    summaryByCode.set(code, current)
  }

  return { summaryByCode, warning: null }
}
