import { createClient } from "@/lib/supabase/server"
import { SuppliersTable } from "@/components/suppliers/suppliers-table"
import { SupplierDialog } from "@/components/suppliers/supplier-dialog"
import { SuppliersBatchActions } from "@/components/suppliers/suppliers-batch-actions"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function SuppliersPage() {
  const supabase = await createClient()

  const { data: suppliers } = await supabase.from("suppliers").select("*").order("created_at", { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">供應商管理</h1>
          <p className="text-muted-foreground">管理您的供應商資料</p>
        </div>
        <div className="flex items-center gap-2">
          <SuppliersBatchActions />
          <SupplierDialog mode="create">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              新增供應商
            </Button>
          </SupplierDialog>
        </div>
      </div>

      <SuppliersTable suppliers={suppliers || []} />
    </div>
  )
}
