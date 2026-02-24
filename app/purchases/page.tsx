import { createClient } from "@/lib/supabase/server"
import { PurchasesTable } from "@/components/purchases/purchases-table"
import PurchaseDialogWrapper from "@/components/purchases/purchase-dialog-wrapper"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function PurchasesPage() {
  const supabase = await createClient()

  const [{ data: purchases }, { data: suppliers }, { data: products }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*)")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("products").select("*").order("pno"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">進貨管理</h1>
          <div className="text-sm text-muted-foreground">
            資料檢查：供應商 {suppliers?.length ?? 0} / 商品 {products?.length ?? 0}
          </div>
          <p className="text-muted-foreground">管理進貨單與進貨紀錄</p>
        </div>
        <PurchaseDialogWrapper suppliers={suppliers || []} products={products || []} />
      </div>

      <PurchasesTable purchases={purchases || []} suppliers={suppliers || []} products={products || []} />
    </div>
  )
}
