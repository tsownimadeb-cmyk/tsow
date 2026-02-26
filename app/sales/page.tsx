import { createClient } from "@/lib/supabase/server"
import { SalesTable } from "@/components/sales/sales-table"
import SalesDialogWrapper from "@/components/sales/sales-dialog-wrapper"
import { SalesBatchActions } from "@/components/sales/sales-batch-actions"
import type { SalesOrder as SalesOrderType, SalesOrderItem as SalesOrderItemType, Product as ProductType } from "@/lib/types"

type SalesRow = Pick<
  SalesOrderType,
  "id" | "order_no" | "customer_cno" | "order_date" | "total_amount" | "status" | "is_paid" | "notes" | "created_at" | "updated_at"
> & {
  sales_order_items: SalesOrderItemType[]
}

function normalizeSales(rows: any[]): SalesRow[] {
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? ""),
    customer_cno: row.customer_cno ?? null,
    order_date: String(row.order_date ?? ""),
    total_amount: Number(row.total_amount ?? 0),
    status: (row.status ?? "pending") as SalesOrderType["status"],
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    notes: row.notes ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    sales_order_items: (row.sales_order_items ?? []) as SalesOrderItemType[],
  }))
}

function normalizeSalesItems(
  rows: any[],
  productMap: Map<string, Pick<ProductType, "code" | "name">>,
): SalesOrderItemType[] {
  return rows.map((row) => {
    const code = (row.code ?? null) as string | null
    return {
      id: String(row.id ?? ""),
      sales_order_id: String(row.sales_order_id ?? ""),
      code,
      quantity: Number(row.quantity ?? 0),
      unit_price: Number(row.unit_price ?? 0),
      subtotal: Number(row.subtotal ?? 0),
      created_at: String(row.created_at ?? ""),
      product: code ? ((productMap.get(code) as ProductType) ?? undefined) : undefined,
    }
  })
}

async function fetchSalesOrders(supabase: Awaited<ReturnType<typeof createClient>>) {
  const baseOrder = { ascending: false as const }

  const primary = await supabase
    .from("sales_orders")
    .select("id,order_no,customer_cno,order_date,total_amount,status,is_paid,notes,created_at,updated_at")
    .order("created_at", baseOrder)

  if (!primary.error) {
    return { data: primary.data || [], warning: null as string | null }
  }

  return {
    data: [] as any[],
    warning: primary.error.message || "查詢 sales_orders 失敗",
  }
}

async function fetchSalesItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  salesIds: string[],
) {
  if (!salesIds.length) {
    return { data: [] as any[], warning: null as string | null }
  }

  const primary = await supabase
    .from("sales_order_items")
    .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
    .in("sales_order_id", salesIds)

  if (!primary.error) {
    return { data: primary.data || [], warning: null as string | null }
  }

  const fallbackProductCode = await supabase
    .from("sales_order_items")
    .select("id,sales_order_id,code:product_code,quantity,unit_price,subtotal,created_at")
    .in("sales_order_id", salesIds)

  if (!fallbackProductCode.error) {
    return {
      data: fallbackProductCode.data || [],
      warning: "sales_order_items 使用 product_code 欄位，已自動對映為 code",
    }
  }

  return {
    data: [] as any[],
    warning: primary.error.message || fallbackProductCode.error?.message || "查詢 sales_order_items 失敗",
  }
}

export default async function SalesPage() {
  const supabase = await createClient()

  const [{ data: customers }, { data: productsRaw }] = await Promise.all([
    supabase.from("customers").select("*").order("code"),
    supabase.from("products").select("*").order("code"),
  ])

  const { data: salesRaw, warning: salesWarning } = await fetchSalesOrders(supabase)

  const products = (productsRaw || []) as ProductType[]
  const productMap = new Map(
    products.map((product) => [String(product.code || ""), { code: product.code, name: product.name }]),
  )

  const salesIds = (salesRaw || [])
    .map((sale) => String(sale.id || "").trim())
    .filter(Boolean)

  const { data: itemsRaw, warning: itemsWarning } = await fetchSalesItems(supabase, salesIds)

  const normalizedItems = normalizeSalesItems(itemsRaw || [], productMap)
  const itemsBySalesOrderId = new Map<string, SalesOrderItemType[]>()

  for (const item of normalizedItems) {
    const salesOrderId = String(item.sales_order_id || "").trim()
    if (!salesOrderId) continue
    const current = itemsBySalesOrderId.get(salesOrderId) || []
    current.push(item)
    itemsBySalesOrderId.set(salesOrderId, current)
  }

  const sales = normalizeSales(
    (salesRaw || []).map((sale) => ({
      ...sale,
      sales_order_items: itemsBySalesOrderId.get(String(sale.id || "").trim()) || [],
    })),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">銷貨管理</h1>
          <p className="text-muted-foreground">管理銷貨單與銷售紀錄</p>
        </div>
        <div className="flex items-center gap-2">
          <SalesBatchActions />
          <SalesDialogWrapper customers={customers || []} products={products || []} />
        </div>
      </div>

      <SalesTable sales={sales || []} customers={customers || []} products={products || []} />

      <div className="text-sm text-muted-foreground">
        資料檢查：客戶 {customers?.length ?? 0} / 商品 {products?.length ?? 0}
      </div>
      {(salesWarning || itemsWarning) && (
        <div className="text-xs text-muted-foreground">
          資料庫欄位自動對映中：{[salesWarning, itemsWarning].filter(Boolean).join("；")}
        </div>
      )}
    </div>
  )
}
