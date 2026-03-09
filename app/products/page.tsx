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

  // 分頁參數
  const PAGE_SIZE = 20
  let page = 1;
  let raw: string | undefined;
  if (searchParams && typeof searchParams === 'object' && Object.prototype.hasOwnProperty.call(searchParams, 'page')) {
    const val = searchParams.page;
    raw = Array.isArray(val) ? val[0] : val;
  }
  const parsed = Number(raw);
  if (!isNaN(parsed) && parsed > 0) page = parsed;
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { rows: productsRaw, totalCount, warning: productsWarning } = await fetchProductsRows(supabase, from, to)

  if (productsWarning) {
    console.error("[ProductsPage] products 查詢失敗:", productsWarning)
  }

  const products = normalizeProducts(productsRaw || [])
  const total = totalCount || 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 產生分頁 URL
  function getPageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (
      searchParams &&
      typeof searchParams === 'object' &&
      !Array.isArray(searchParams) &&
      searchParams !== null &&
      searchParams.constructor === Object
    ) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (key === 'page') continue;
        if (!Object.prototype.hasOwnProperty.call(searchParams, key)) continue;
        if (typeof value === 'string') params.set(key, value);
        else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
      }
    }
    params.set('page', String(targetPage));
    return `/products?${params.toString()}`;
  }

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
          {/* 庫存重算按鈕 Client Component */}
          <RecalcStockBtn />
          <div className="flex-1" />
          <ProductsBatchActions />
        </div>
      </div>

      <ProductsTable products={products} />

      {/* 分頁控制 */}
      <div className="flex items-center justify-center gap-4 mt-4">
        <a href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`btn ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}>上一頁</a>
        <span>第 {page} 頁 / 共 {totalPages} 頁</span>
        <a href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`btn ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}>下一頁</a>
      </div>
    </div>
  )
}
