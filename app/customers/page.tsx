import { createClient } from "@/lib/supabase/server"
import { CustomersTable } from "@/components/customers/customers-table"
import { CustomerDialog } from "@/components/customers/customer-dialog"
import { CustomersBatchActions } from "@/components/customers/customers-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

import { fetchCustomersRows, normalizeCustomers } from "@/lib/customers"

export default async function CustomersPage(props: any) {
  const searchParams = await props.searchParams;
  const PAGE_SIZE = 20;
  let page = 1;
  let raw: string | undefined;
  if (searchParams && typeof searchParams === 'object' && Object.prototype.hasOwnProperty.call(searchParams, 'page')) {
    const val = searchParams.page;
    raw = Array.isArray(val) ? val[0] : val;
  }
  const parsed = Number(raw);
  if (!isNaN(parsed) && parsed > 0) page = parsed;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const { rows: customersRaw, totalCount, warning: customersWarning } = await fetchCustomersRows(supabase, from, to);
  if (customersWarning) {
    console.error("[CustomersPage] 查詢 customers 失敗:", customersWarning);
  }
  const customers = normalizeCustomers(customersRaw || []);
  const total = totalCount || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
    return `/customers?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶管理</h1>
          <p className="text-muted-foreground">管理您的客戶資料</p>
        </div>
        <div className="flex items-center gap-2">
          <CustomerDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增客戶
            </Button>
          </CustomerDialog>
          <CustomersBatchActions />
        </div>
      </div>

      <CustomersTable customers={customers} />

      {/* 分頁控制 */}
      <div className="flex items-center justify-center gap-4 mt-4">
        <a href={getPageUrl(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0} className={`btn ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}>上一頁</a>
        <span>第 {page} 頁 / 共 {totalPages} 頁</span>
        <a href={getPageUrl(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0} className={`btn ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}>下一頁</a>
        {/* 指定跳頁 */}
        <form method="get" action="/customers" className="flex items-center gap-2" style={{ display: 'inline' }}>
          <input
            type="number"
            name="page"
            min={1}
            max={totalPages}
            defaultValue={page}
            className="border rounded px-2 py-1 w-16 text-center"
            aria-label="跳至指定頁數"
          />
          <button type="submit" className="btn">跳頁</button>
        </form>
      </div>
    </div>
  );
}
