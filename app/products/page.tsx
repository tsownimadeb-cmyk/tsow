import { createClient } from "@/lib/supabase/server"
import { ProductsTable } from "@/components/products/products-table"
import { ProductDialog } from "@/components/products/product-dialog"
import { ProductsBatchActions } from "@/components/products/products-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { unstable_noStore as noStore } from "next/cache"
import { fetchProductsRows, normalizeProducts } from "@/lib/products"

export default async function ProductsPage() {
  noStore()
  const supabase = await createClient()

  const { rows: productsRaw, warning: productsWarning } = await fetchProductsRows(supabase)

  if (productsWarning) {
    console.error("[ProductsPage] products 查詢失敗:", productsWarning)
  }

  const products = normalizeProducts(productsRaw || [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">商品管理</h1>
          <p className="text-muted-foreground">管理您的商品與庫存</p>
        </div>
        <div className="flex items-center gap-2">
          <ProductsBatchActions />
          <ProductDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增商品
            </Button>
          </ProductDialog>
        </div>
      </div>

      <ProductsTable products={products} />
    </div>
  )
}
