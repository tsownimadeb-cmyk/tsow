import { createClient } from "@/lib/supabase/server"
import { CustomersTable } from "@/components/customers/customers-table"
import { CustomerDialog } from "@/components/customers/customer-dialog"
import { CustomersBatchActions } from "@/components/customers/customers-batch-actions"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus } from "lucide-react"
import { fetchCustomersRows, normalizeCustomers } from "@/lib/customers"

export default async function CustomersPage(props: any) {
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

  const supabase = await createClient();
  const { rows: customersRaw, totalCount, warning: customersWarning } = await fetchCustomersRows(supabase, from, to, searchText);
  if (customersWarning) {
    console.error("[CustomersPage] 查詢 customers 失敗:", customersWarning);
  }
  const customers = normalizeCustomers(customersRaw || []);
  const total = totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function getPageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (searchText) params.set('search', searchText);
    params.set('page', String(targetPage));
    return `/customers?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">客戶管理</h1>
          <p className="text-sm text-muted-foreground">管理您的客戶資料</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CustomerDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增客戶
            </Button>
          </CustomerDialog>
          <CustomersBatchActions />
        </div>
      </div>

      <CustomersTable customers={customers} initialSearchText={searchText} />

      {/* 分頁控制 */}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-sm">
        <Link href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}>上一頁</Link>
        <span className="px-2 text-muted-foreground">第 {page} 頁 / 共 {totalPages} 頁（共 {total} 筆）</span>
        <Link href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}>下一頁</Link>
        <form method="get" action="/customers" className="flex items-center gap-1.5">
          {searchText && <input type="hidden" name="search" value={searchText} />}
          <input type="number" name="page" min={1} max={totalPages} defaultValue={page} className="border rounded px-2 py-1 w-14 text-center text-sm" aria-label="跳至指定頁數" />
          <button type="submit" className="px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50">跳頁</button>
        </form>
      </div>
    </div>
  );
}
