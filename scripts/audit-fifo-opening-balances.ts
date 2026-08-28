import { createClient } from "@supabase/supabase-js"

async function main() {
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const email = process.env.SUPABASE_AUTH_EMAIL
const password = process.env.SUPABASE_AUTH_PASSWORD
if (!url || !key || !email || !password) throw new Error("Missing Supabase configuration")

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
if (authError) throw authError

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const add = (target: Map<string, number>, codeValue: unknown, quantityValue: unknown) => {
  const code = normalizeCode(codeValue)
  if (!code) return
  target.set(code, (target.get(code) ?? 0) + number(quantityValue))
}

async function fetchAll(table: string, select: string, orderBy = "id") {
  const rows: any[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select, { count: "exact" })
      .order(orderBy, { ascending: true })
      .range(offset, offset + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

const [
  products,
  purchaseOrders,
  purchaseItems,
  salesOrders,
  salesItems,
  purchaseReturns,
  purchaseReturnItems,
  salesReturns,
  salesReturnItems,
  adjustments,
  openings,
] = await Promise.all([
  fetchAll("products", "code,name,stock_qty,cost", "code"),
  fetchAll("purchase_orders", "id,status"),
  fetchAll("purchase_order_items", "id,purchase_order_id,code,quantity"),
  fetchAll("sales_orders", "id,status"),
  fetchAll("sales_order_items", "id,sales_order_id,code,quantity"),
  fetchAll("purchase_returns", "id,status"),
  fetchAll("purchase_return_items", "id,purchase_return_id,product_id,product_code,quantity"),
  fetchAll("sales_returns", "id,status"),
  fetchAll("sales_return_items", "id,sales_return_id,product_id,product_code,quantity"),
  fetchAll("stock_adjustments", "id,product_code,adjustment_qty,fifo_resolution,fifo_unit_cost,created_at"),
  fetchAll("fifo_opening_balances", "product_code,quantity,unit_cost,source_note", "product_code"),
])

const completedIds = (rows: any[]) => new Set(rows.filter((row) => String(row.status || "").trim().toLowerCase() === "completed").map((row) => String(row.id)))
const completedPurchaseIds = completedIds(purchaseOrders)
const completedSalesIds = completedIds(salesOrders)
const completedPurchaseReturnIds = completedIds(purchaseReturns)
const completedSalesReturnIds = completedIds(salesReturns)

const purchased = new Map<string, number>()
const sold = new Map<string, number>()
const purchaseReturned = new Map<string, number>()
const salesReturned = new Map<string, number>()
const datedAdjustments = new Map<string, number>()
const unresolvedAdjustments = new Map<string, number>()

for (const row of purchaseItems) if (completedPurchaseIds.has(String(row.purchase_order_id))) add(purchased, row.code, row.quantity)
for (const row of salesItems) if (completedSalesIds.has(String(row.sales_order_id))) add(sold, row.code, row.quantity)
for (const row of purchaseReturnItems) {
  if (completedPurchaseReturnIds.has(String(row.purchase_return_id))) add(purchaseReturned, row.product_code || row.product_id, row.quantity)
}
for (const row of salesReturnItems) {
  if (completedSalesReturnIds.has(String(row.sales_return_id))) add(salesReturned, row.product_code || row.product_id, row.quantity)
}
for (const row of adjustments) {
  const resolution = String(row.fifo_resolution || "")
  if (resolution === "dated_increase" || resolution === "dated_decrease") add(datedAdjustments, row.product_code, row.adjustment_qty)
  else if (resolution !== "opening_balance" && resolution !== "ignored") add(unresolvedAdjustments, row.product_code, row.adjustment_qty)
}

const openingMap = new Map(openings.map((row) => [normalizeCode(row.product_code), row]))
const rows = products.map((product) => {
  const code = normalizeCode(product.code)
  const currentStock = number(product.stock_qty)
  const netRecordedMovement =
    number(purchased.get(code)) -
    number(sold.get(code)) -
    number(purchaseReturned.get(code)) +
    number(salesReturned.get(code)) +
    number(datedAdjustments.get(code)) +
    number(unresolvedAdjustments.get(code))
  const inferredOpeningQty = currentStock - netRecordedMovement
  const existing = openingMap.get(code)
  const existingQty = existing ? number(existing.quantity) : 0
  return {
    code,
    name: String(product.name || ""),
    currentStock,
    purchased: number(purchased.get(code)),
    sold: number(sold.get(code)),
    purchaseReturned: number(purchaseReturned.get(code)),
    salesReturned: number(salesReturned.get(code)),
    datedAdjustments: number(datedAdjustments.get(code)),
    unresolvedAdjustments: number(unresolvedAdjustments.get(code)),
    inferredOpeningQty,
    existingOpeningQty: existingQty,
    openingDifference: inferredOpeningQty - existingQty,
    existingOpeningCost: existing ? number(existing.unit_cost) : null,
    productFallbackCost: number(product.cost),
  }
}).sort((left, right) => Math.abs(right.openingDifference) - Math.abs(left.openingDifference) || left.code.localeCompare(right.code))

const adjustmentResolutionCountMap = new Map<string, number>()
for (const row of adjustments) {
  const resolution = String(row.fifo_resolution || "unresolved") || "unresolved"
  adjustmentResolutionCountMap.set(resolution, (adjustmentResolutionCountMap.get(resolution) ?? 0) + 1)
}
const adjustmentResolutionCounts = Object.fromEntries(
  Array.from(adjustmentResolutionCountMap.entries()).sort(([left], [right]) => left.localeCompare(right)),
)

console.log(JSON.stringify({
  summary: {
    products: products.length,
    existingOpeningRows: openings.length,
    productsWithOpeningMismatch: rows.filter((row) => Math.abs(row.openingDifference) > 0.0001).length,
    productsWithNegativeInferredOpening: rows.filter((row) => row.inferredOpeningQty < -0.0001).length,
    productsWithUnresolvedAdjustments: rows.filter((row) => Math.abs(row.unresolvedAdjustments) > 0.0001).length,
    completedPurchaseReturnItems: purchaseReturnItems.filter((row) => completedPurchaseReturnIds.has(String(row.purchase_return_id))).length,
    completedSalesReturnItems: salesReturnItems.filter((row) => completedSalesReturnIds.has(String(row.sales_return_id))).length,
    adjustmentResolutionCounts,
  },
  mismatches: rows.filter((row) => Math.abs(row.openingDifference) > 0.0001),
}, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
