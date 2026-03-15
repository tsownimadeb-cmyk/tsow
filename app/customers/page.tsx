import { createClient } from "@/lib/supabase/server"
import { CustomersTable } from "@/components/customers/customers-table"
import { CustomerDialog } from "@/components/customers/customer-dialog"
import { CustomersBatchActions } from "@/components/customers/customers-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

import { fetchCustomersRows, normalizeCustomers } from "@/lib/customers"

export default async function CustomersPage(props: any) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  // 一次查詢所有客戶（不分頁）
  const { rows: customersRaw, totalCount, warning: customersWarning } = await fetchCustomersRows(supabase, 0, 99999, "");
  if (customersWarning) {
    console.error("[CustomersPage] 查詢 customers 失敗:", customersWarning);
  }
  const customers = normalizeCustomers(customersRaw || []);

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

      {/* 已不分頁，移除分頁控制區塊 */}
    </div>
  );
}
