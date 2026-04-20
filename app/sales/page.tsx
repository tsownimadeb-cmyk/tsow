import { createClient } from "@/lib/supabase/server"
import { SalesTable } from "@/components/sales/sales-table"
import SalesDialogWrapper from "@/components/sales/sales-dialog-wrapper"
import { SalesBatchActions } from "@/components/sales/sales-batch-actions"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Printer } from "lucide-react"
import { fetchSalesRows, normalizeSales } from "@/lib/sales"

export default async function SalesPage(props: any) {
  const searchParams = await props.searchParams;
  const PAGE_SIZE = 20;
  let page = 1;
  let raw: string | undefined;
  let searchText = "";
  let productSearchText = "";
  if (searchParams && typeof searchParams === 'object') {
    if (Object.prototype.hasOwnProperty.call(searchParams, 'page')) {
      const val = searchParams.page;
      raw = Array.isArray(val) ? val[0] : val;
    }
    if (Object.prototype.hasOwnProperty.call(searchParams, 'search')) {
      const val = searchParams.search;
      searchText = Array.isArray(val) ? val[0] : val;
    }
    if (Object.prototype.hasOwnProperty.call(searchParams, 'productSearch')) {
      const val = searchParams.productSearch;
      productSearchText = Array.isArray(val) ? val[0] : val;
    }
  }
  const parsed = Number(raw);
  if (!isNaN(parsed) && parsed > 0) page = parsed;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  // 分頁查詢銷貨單（支援單號 / 客戶 / 商品搜尋）
  const { rows: salesRaw, totalCount, warning: salesWarning } = await fetchSalesRows(
    supabase,
    from,
    to,
    searchText,
    productSearchText,
  );

  // 客戶與商品查詢（不分頁）
  const [{ data: customers }, { data: products }] = await Promise.all([
    supabase.from("customers").select("*").order("code"),
    supabase.from("products").select("*").order("code"),
  ]);

  if (salesWarning) {
    console.error("[SalesPage] 查詢 sales_orders 失敗:", salesWarning);
  }

  const sales = normalizeSales(salesRaw || []);
  const total = totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 產生分頁 URL
  function getPageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (searchParams && typeof searchParams === 'object' && !Array.isArray(searchParams)) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (key === 'page') continue;
        if (typeof value === 'string') params.set(key, value);
        else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
      }
    }
    params.set('page', String(targetPage));
    return `/sales?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">銷貨管理</h1>
          <p className="text-sm text-muted-foreground">管理銷貨單與銷售紀錄</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/sales/print/today">
              <Printer className="h-4 w-4" />
              今日出貨列印
            </Link>
          </Button>
          <SalesDialogWrapper customers={customers || []} products={products || []} />
          <SalesBatchActions />
        </div>
      </div>

      <SalesTable
        sales={sales || []}
        customers={customers || []}
        products={products || []}
        initialSearch={searchText}
        initialProductSearch={productSearchText}
      />

      {/* 分頁控制 */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-sm">
        <Link href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}>上一頁</Link>
        <span className="px-2 text-muted-foreground">第 {page} 頁 / 共 {totalPages} 頁</span>
        <Link href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}>下一頁</Link>
        <form method="get" action="/sales" className="flex items-center gap-1.5">
          {searchText ? <input type="hidden" name="search" value={searchText} /> : null}
          {productSearchText ? <input type="hidden" name="productSearch" value={productSearchText} /> : null}
          <input type="number" name="page" min={1} max={totalPages} defaultValue={page} className="border rounded px-2 py-1 w-14 text-center text-sm" aria-label="跳至指定頁數" />
          <button type="submit" className="px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50">跳頁</button>
        </form>
      </div>
    </div>
  );
}
