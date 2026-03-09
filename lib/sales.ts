import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchSalesRows(supabase: any, from: number = 0, to: number = 19): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  const selectText = "id,order_no,customer_cno,delivery_method,order_date,total_amount,status,is_paid,notes,created_at,updated_at"
  const result: PostgrestSingleResponse<any> = await supabase
    .from("sales_orders")
    .select(selectText, { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  const salesRows = result.data || []
  const salesIds = salesRows.map((row: any) => row.id)
  let itemsBySalesId: Record<string, any[]> = {}

  if (salesIds.length > 0) {
    const itemsResult: PostgrestSingleResponse<any> = await supabase
      .from("sales_order_items")
      .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
      .in("sales_order_id", salesIds)

    if (itemsResult.data) {
      for (const item of itemsResult.data) {
        if (!itemsBySalesId[item.sales_order_id]) itemsBySalesId[item.sales_order_id] = []
        itemsBySalesId[item.sales_order_id].push(item)
      }
    }
  }

  const rowsWithItems = salesRows.map((row: any) => ({
    ...row,
    items: itemsBySalesId[row.id] || [],
  }))

  return {
    rows: rowsWithItems,
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizeSales(rows: any[]): any[] {
  return rows.map((row) => ({ ...row }))
}
