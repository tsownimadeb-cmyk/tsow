import { createClient } from "@/lib/supabase/server"
import { SalesTable } from "@/components/sales/sales-table"
import SalesDialogWrapper from "@/components/sales/sales-dialog-wrapper"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function SalesPage() {
  const supabase = await createClient()

  const [{ data: sales }, { data: customers }, { data: products }] = await Promise.all([
    supabase.from("sales_orders").select("*, sales_order_items(*)").order("created_at", { ascending: false }),
    supabase.from("customers").select("*").order("cno"),
    supabase.from("products").select("*").order("pno"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">銷貨管理</h1>
          <p className="text-muted-foreground">管理銷貨單與銷售紀錄</p>
        </div>
        <SalesDialogWrapper customers={customers || []} products={products || []} />
      </div>

      <SalesTable sales={sales || []} customers={customers || []} products={products || []} />
      <div className="text-sm text-muted-foreground">
        資料檢查：客戶 {customers?.length ?? 0} / 商品 {products?.length ?? 0}
      </div>
    </div>
  )
}
