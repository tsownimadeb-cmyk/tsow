import { createClient } from "@/lib/supabase/server"
import InventoryAuditPanel from "@/components/sales/inventory-audit-panel"

export const dynamic = "force-dynamic"

type InventoryAuditProduct = {
  code: string
  name: string
  stock_qty: number
  price: number | null
  sale_price: number | null
}

export default async function InventoryAuditPage() {
  let products: InventoryAuditProduct[] = []
  let loadError: string | null = null

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("products")
      .select("code,name,stock_qty,price,sale_price")
      .gt("stock_qty", 0)
      .order("code", { ascending: true })

    if (error) {
      throw error
    }

    products = (data || []).map((row: any) => ({
      code: String(row.code ?? ""),
      name: String(row.name ?? ""),
      stock_qty: Number(row.stock_qty ?? 0),
      price: row.price === null || row.price === undefined ? null : Number(row.price),
      sale_price: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    }))
  } catch (error: any) {
    loadError = String(error?.message || "讀取商品資料失敗")
    console.error("[InventoryAuditPage] 讀取失敗：", error)
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">庫存盤點</h1>
          <p className="text-sm text-muted-foreground mt-1">
            盤點後會建立盤點銷貨單，並同步更新 products.stock_qty。
          </p>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          無法載入商品：{loadError}
        </div>
      ) : (
        <InventoryAuditPanel products={products} />
      )}
    </div>
  )
}
