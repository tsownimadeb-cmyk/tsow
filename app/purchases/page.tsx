import { createClient } from "@/lib/supabase/server"
import { PurchasesTable } from "@/components/purchases/purchases-table"
import PurchaseDialogWrapper from "@/components/purchases/purchase-dialog-wrapper"
import { PurchasesBatchActions } from "@/components/purchases/purchases-batch-actions"
import { ErrorToast } from "@/components/ui/error-toast"
import type { Product, PurchaseOrderItem } from "@/lib/types"

function normalizeProductRow(row: any): Product {
  return {
    code: String(row.code ?? row.pno ?? ""),
    name: String(row.name ?? row.pname ?? ""),
    spec: (row.spec ?? null) as string | null,
    unit: (row.unit ?? null) as string | null,
    category: (row.category ?? null) as string | null,
    cost: Number(row.cost ?? 0),
    price: Number(row.price ?? 0),
    sale_price: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    stock_qty: Number(row.stock_qty ?? row.stock_quantity ?? 0),
    purchase_qty_total: Number(row.purchase_qty_total ?? 0),
    safety_stock: Number(row.safety_stock ?? row.min_stock_level ?? 0),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  }
}

async function fetchProductsForPurchases(supabase: Awaited<ReturnType<typeof createClient>>) {
  const attempts = [
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock,created_at,updated_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock,created_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,created_at,updated_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,created_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total",
    "code,name,spec,unit,category,cost,price,sale_price,stock_quantity,min_stock_level,created_at,updated_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_quantity,min_stock_level,created_at",
    "code,name,spec,unit,category,cost,price,sale_price,stock_quantity,min_stock_level",
    "code,name,spec,unit,category,cost,price,sale_price,created_at,updated_at",
    "code,name,spec,unit,category,cost,price,sale_price,created_at",
    "code,name,spec,unit,category,cost,price,sale_price",
  ]

  let lastErrorMessage: string | null = null

  for (const selectText of attempts) {
    const result = await supabase.from("products").select(selectText).order("code", { ascending: true })
    if (!result.error) {
      return {
        data: (result.data || []).map(normalizeProductRow),
        warning: null as string | null,
      }
    }
    lastErrorMessage = result.error.message
  }

  return {
    data: [] as Product[],
    warning: lastErrorMessage || "查詢 products 失敗",
  }
}

async function fetchPurchaseItemsForOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  purchaseOrders: any[],
) {
  const orderNos = purchaseOrders.map((purchase) => String(purchase.order_no || "").trim()).filter(Boolean)
  const purchaseIds = purchaseOrders.map((purchase) => String(purchase.id || "").trim()).filter(Boolean)
  const orderNoById = new Map(purchaseOrders.map((purchase) => [String(purchase.id || ""), String(purchase.order_no || "")]))

  if (!orderNos.length && !purchaseIds.length) {
    return {
      data: [] as Array<PurchaseOrderItem & { order_no?: string }>,
      warning: null as string | null,
    }
  }

  const tryNew = orderNos.length
    ? await supabase
        .from("purchase_order_items")
        .select("id,order_no,code,quantity,unit_price,subtotal,created_at")
        .in("order_no", orderNos)
    : { data: [] as any[], error: null as any }

  if (!tryNew.error) {
    return {
      data: (tryNew.data || []).map((item: any) => ({
        id: String(item.id ?? ""),
        purchase_order_id: "",
        order_no: String(item.order_no ?? ""),
        code: (item.code ?? null) as string | null,
        quantity: Number(item.quantity ?? 0),
        unit_price: Number(item.unit_price ?? 0),
        subtotal: Number(item.subtotal ?? 0),
        created_at: String(item.created_at ?? ""),
      })),
      warning: null as string | null,
    }
  }

  const tryLegacy = purchaseIds.length
    ? await supabase
        .from("purchase_order_items")
        .select("id,purchase_order_id,code,quantity,unit_price,subtotal,created_at")
        .in("purchase_order_id", purchaseIds)
    : { data: [] as any[], error: null as any }

  if (!tryLegacy.error) {
    return {
      data: (tryLegacy.data || []).map((item: any) => ({
        id: String(item.id ?? ""),
        purchase_order_id: String(item.purchase_order_id ?? ""),
        order_no: String(orderNoById.get(String(item.purchase_order_id ?? "")) ?? ""),
        code: (item.code ?? null) as string | null,
        quantity: Number(item.quantity ?? 0),
        unit_price: Number(item.unit_price ?? 0),
        subtotal: Number(item.subtotal ?? 0),
        created_at: String(item.created_at ?? ""),
      })),
      warning: null as string | null,
    }
  }

  return {
    data: [] as Array<PurchaseOrderItem & { order_no?: string }>,
    warning: tryNew.error?.message || tryLegacy.error?.message || "查詢 purchase_order_items 失敗",
  }
}

export default async function PurchasesPage() {
  const supabase = await createClient()

  const [purchasesResult, suppliersResult] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id,order_no,supplier_id,order_date,total_amount,status,is_paid,notes,created_at,updated_at")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id,name,contact_person,phone,email,address,notes,created_at,updated_at").order("name"),
  ])

  const purchasesRaw = purchasesResult.data || []
  const suppliers = suppliersResult.data || []
  const { data: products, warning: productsWarning } = await fetchProductsForPurchases(supabase)

  if (purchasesResult.error) {
    console.error("[PurchasesPage] 查詢 purchase_orders 失敗:", purchasesResult.error)
  }
  if (suppliersResult.error) {
    console.error("[PurchasesPage] 查詢 suppliers 失敗:", suppliersResult.error)
  }
  if (productsWarning) {
    console.error("[PurchasesPage] 查詢 products 失敗:", productsWarning)
  }

  const { data: itemsRaw, warning: itemsWarning } = await fetchPurchaseItemsForOrders(supabase, purchasesRaw)
  if (itemsWarning) {
    console.error("[PurchasesPage] 查詢 purchase_order_items 失敗:", itemsWarning)
  }

  const queryErrors = [
    purchasesResult.error?.message,
    suppliersResult.error?.message,
    productsWarning,
    itemsWarning,
  ].filter((message): message is string => Boolean(message))

  const productNameByCode = new Map((products || []).map((product: Product) => [String(product.code || ""), String(product.name || "")]))

  const itemsByOrderNo = new Map<string, any[]>()
  for (const item of itemsRaw || []) {
    const orderNo = String(item.order_no || "").trim()
    if (!orderNo) continue
    const current = itemsByOrderNo.get(orderNo) || []
    current.push({
      ...item,
      product: item.code ? { code: item.code, name: productNameByCode.get(String(item.code || "")) || String(item.code) } : undefined,
    })
    itemsByOrderNo.set(orderNo, current)
  }

  const purchases = (purchasesRaw || []).map((purchase: any) => ({
    ...purchase,
    items: itemsByOrderNo.get(String(purchase.order_no || "").trim()) || [],
  }))

  return (
    <div className="space-y-6">
      <ErrorToast messages={queryErrors} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">進貨管理</h1>
          <div className="text-sm text-muted-foreground">
            資料檢查：供應商 {suppliers?.length ?? 0} / 商品 {products?.length ?? 0}
          </div>
          <p className="text-muted-foreground">管理進貨單與進貨紀錄</p>
        </div>
        <div className="flex items-center gap-2">
          <PurchasesBatchActions />
          <PurchaseDialogWrapper suppliers={suppliers || []} products={products || []} />
        </div>
      </div>

      <PurchasesTable purchases={purchases || []} suppliers={suppliers || []} products={products || []} />
    </div>
  )
}
