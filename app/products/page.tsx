import { createClient } from "@/lib/supabase/server"
import { ProductsTable } from "@/components/products/products-table"
import { ProductDialog } from "@/components/products/product-dialog"
import { ProductsBatchActions } from "@/components/products/products-batch-actions"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus } from "lucide-react"
import { fetchProductsRows, normalizeProducts } from "@/lib/products"
import { RecalcStockBtn } from "@/components/products/recalc-stock-btn"

export default async function ProductsPage(props: any) {
  const searchParams = await props.searchParams;
  const PAGE_SIZE = 20;
  let page = 1;
  let searchText = "";
  if (searchParams && typeof searchParams === 'object') {
    const rawPage = searchParams.page;
    const p = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage);
    if (!isNaN(p) && p > 0) page = p;
    const rawSearch = searchParams.search;
    if (rawSearch) searchText = Array.isArray(rawSearch) ? rawSearch[0] : rawSearch;
  }
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient()
  const { rows: productsRaw, totalCount, warning: productsWarning } = await fetchProductsRows(supabase, from, to, searchText)

  if (productsWarning) {
    console.error("[ProductsPage] products 查詢失敗:", productsWarning)
  }

  const products = normalizeProducts(productsRaw || [])
  const total = totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function getPageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (searchText) params.set('search', searchText);
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
          {/* 庫存重算按鈕 Client Component（已隱藏） */}
          {/* <RecalcStockBtn /> */}
          <div className="flex-1" />
          <ProductsBatchActions />
        </div>
      </div>

      <ProductsTable products={products} initialSearch={searchText} />

      {/* 分頁控制 */}
      <div className="flex items-center justify-center gap-4 mt-4">
        <Link href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`btn ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}>上一頁</Link>
        <span>第 {page} 頁 / 共 {totalPages} 頁（共 {total} 筆）</span>
        <Link href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`btn ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}>下一頁</Link>
        <form method="get" action="/products" className="flex items-center gap-2">
          {searchText && <input type="hidden" name="search" value={searchText} />}
          <input type="number" name="page" min={1} max={totalPages} defaultValue={page} className="border rounded px-2 py-1 w-16 text-center" aria-label="跳至指定頁數" />
          <button type="submit" className="btn">跳頁</button>
        </form>
      </div>
    </div>
  )
}
