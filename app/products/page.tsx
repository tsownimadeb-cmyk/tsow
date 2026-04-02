import { createClient } from "@/lib/supabase/server"
import { ProductsTable } from "@/components/products/products-table"
import { ProductDialog } from "@/components/products/product-dialog"
import { ProductsBatchActions } from "@/components/products/products-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { unstable_noStore as noStore } from "next/cache"
import { fetchProductsRows, normalizeProducts } from "@/lib/products"
import { RecalcStockBtn } from "@/components/products/recalc-stock-btn"

interface ProductsPageProps {
  searchParams?: { [key: string]: string | string[] | undefined }
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  noStore()
  const supabase = await createClient()

  // 取得所有商品（不分頁）
  const { rows: productsRaw, totalCount, warning: productsWarning } = await fetchProductsRows(supabase, 0, 99999)

  if (productsWarning) {
    console.error("[ProductsPage] products 查詢失敗:", productsWarning)
  }

  const products = normalizeProducts(productsRaw || [])

  // 不再需要分頁 URL 產生器

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">商品管理</h1>
          <p className="text-muted-foreground">管理您的商品與庫存</p>
        </div>
        <div className="flex items-center gap-2">
          <ProductDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增商品
            </Button>
          </ProductDialog>
          {/* 庫存重算按鈕 Client Component（已隱藏） */}
          {/* <RecalcStockBtn /> */}
          <div className="flex-1" />
          <ProductsBatchActions />
        </div>
      </div>

      <ProductsTable products={products} />
      {/* 移除分頁控制區塊 */}
    </div>
  )
}
