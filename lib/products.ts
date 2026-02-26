import type { Product as ProductType } from "@/lib/types"

export type ProductListRow = Pick<
  ProductType,
  "code" | "name" | "spec" | "unit" | "category" | "cost" | "price" | "sale_price"
> & {
  stock_qty: number
  purchase_qty_total: number
  safety_stock: number
}

export function normalizeProducts(rows: any[]): ProductListRow[] {
  return rows.map((row) => ({
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    spec: (row.spec ?? row.specification ?? null) as string | null,
    unit: (row.unit ?? null) as string | null,
    category: (row.category ?? null) as string | null,
    cost: Number(row.cost ?? 0),
    price: Number(row.price ?? 0),
    sale_price: row.sale_price === null || row.sale_price === undefined ? null : Number(row.sale_price),
    stock_qty: Number(row.stock_qty ?? 0),
    purchase_qty_total: Number(row.purchase_qty_total ?? 0),
    safety_stock: Number(row.safety_stock ?? 0),
  }))
}

export async function fetchProductsRows(supabase: any) {
  const queryByPriority = [
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock",
    "code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total",
  ]

  for (const selectText of queryByPriority) {
    const result = await supabase.from("products").select(selectText).order("code", { ascending: true })
    if (!result.error) {
      return {
        rows: result.data || [],
        warning: null as string | null,
      }
    }
  }

  const finalAttempt = await supabase
    .from("products")
    .select("code,name,spec,unit,category,cost,price,sale_price")
    .order("code", { ascending: true })

  return {
    rows: finalAttempt.data || [],
    warning: finalAttempt.error?.message || "products 查詢失敗，已回退為基本欄位",
  }
}
