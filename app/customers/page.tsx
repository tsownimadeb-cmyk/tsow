import { createClient } from "@/lib/supabase/server"
import { CustomersTable } from "@/components/customers/customers-table"
import { CustomerDialog } from "@/components/customers/customer-dialog"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function CustomersPage() {
  const supabase = await createClient()
const { data: customers } = await supabase.from("customers").select("*").order("code", { ascending: true })
 

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶管理</h1>
          <p className="text-muted-foreground">管理您的客戶資料</p>
        </div>
        <CustomerDialog mode="create">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新增客戶
          </Button>
        </CustomerDialog>
      </div>

      <CustomersTable customers={customers || []} />
    </div>
  )
}
