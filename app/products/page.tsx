import { createClient } from "@/lib/supabase/server"
import { ProductsTable } from "@/components/products/products-table"
import { ProductDialog } from "@/components/products/product-dialog"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export default async function ProductsPage() {
  const supabase = await createClient()

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("categories").select("*").order("name"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">商品管理</h1>
          <p className="text-muted-foreground">管理您的商品與庫存</p>
        </div>
        <ProductDialog categories={categories || []} mode="create">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新增商品
          </Button>
        </ProductDialog>
      </div>

      <ProductsTable products={products || []} categories={categories || []} />
    </div>
  )
}
