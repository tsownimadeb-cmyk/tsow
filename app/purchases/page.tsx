import { createClient } from "@/lib/supabase/server"
import { PurchasesTable } from "@/components/purchases/purchases-table"
import PurchaseDialogWrapper from "@/components/purchases/purchase-dialog-wrapper"
import { PurchasesBatchActions } from "@/components/purchases/purchases-batch-actions"
import { ErrorToast } from "@/components/ui/error-toast"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { fetchPurchasesRows, normalizePurchases } from "@/lib/purchases"

export default async function PurchasesPage(props: any) {
  const searchParams = await props.searchParams;
  const PAGE_SIZE = 20;
  let page = 1;
  let raw: string | undefined;
  let searchText = "";
  if (searchParams && typeof searchParams === 'object') {
    if (Object.prototype.hasOwnProperty.call(searchParams, 'page')) {
      const val = searchParams.page;
      raw = Array.isArray(val) ? val[0] : val;
    }
    if (Object.prototype.hasOwnProperty.call(searchParams, 'search')) {
      const val = searchParams.search;
      searchText = Array.isArray(val) ? val[0] : val;
    }
  }
  const parsed = Number(raw);
  if (!isNaN(parsed) && parsed > 0) page = parsed;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  // 分頁查詢進貨單（支援搜尋）
  const { rows: purchasesRaw, totalCount, warning: purchasesWarning } = await fetchPurchasesRows(supabase, from, to, searchText);

  // 供應商與商品查詢（不分頁）
  const [suppliersResult, productsResult] = await Promise.all([
    supabase.from("suppliers").select("id,name,contact_person,phone,phone2,phone3,email,address,notes,created_at,updated_at").order("name"),
    supabase.from("products").select("code,name,spec,unit,category,base_price,purchase_price,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock,created_at,updated_at").order("code"),
  ]);
  const suppliers = suppliersResult.data || [];
  const products = productsResult.data || [];

  if (purchasesWarning) {
    console.error("[PurchasesPage] 查詢 purchase_orders 失敗:", purchasesWarning);
  }
  if (suppliersResult.error) {
    console.error("[PurchasesPage] 查詢 suppliers 失敗:", suppliersResult.error);
  }
  if (productsResult.error) {
    console.error("[PurchasesPage] 查詢 products 失敗:", productsResult.error);
  }

  const purchases = normalizePurchases(purchasesRaw || []);
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
    return `/purchases?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">進貨管理</h1>
          <p className="text-sm text-muted-foreground">管理進貨單與進貨紀錄</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PurchaseDialogWrapper suppliers={suppliers || []} products={products || []} />
          <PurchasesBatchActions />
        </div>
      </div>

      <PurchasesTable purchases={purchases || []} suppliers={suppliers || []} products={products || []} />

      {/* 分頁控制 */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-sm">
        <Link href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}>上一頁</Link>
        <span className="px-2 text-muted-foreground">第 {page} 頁 / 共 {totalPages} 頁</span>
        <Link href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}>下一頁</Link>
        <form method="get" action="/purchases" className="flex items-center gap-1.5">
          {searchText && <input type="hidden" name="search" value={searchText} />}
          <input type="number" name="page" min={1} max={totalPages} defaultValue={page} className="border rounded px-2 py-1 w-14 text-center text-sm" aria-label="跳至指定頁數" />
          <button type="submit" className="px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50">跳頁</button>
        </form>
      </div>
    </div>
  );
}
