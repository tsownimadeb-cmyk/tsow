import { createClient } from "@/lib/supabase/server"
import { CustomersTable } from "@/components/customers/customers-table"
import { CustomerDialog } from "@/components/customers/customer-dialog"
import { CustomersBatchActions } from "@/components/customers/customers-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function CustomersPage() {
  const supabase = await createClient()
  const pageSize = 1000
  const customers: any[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("code", { ascending: true })
      .range(from, to)

    if (error) {
      throw new Error(`讀取客戶資料失敗：${error.message}`)
    }

    const batch = data || []
    customers.push(...batch)

    if (batch.length < pageSize) {
      break
    }
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
    </div>
  )
}
