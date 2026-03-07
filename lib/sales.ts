import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchSalesRows(supabase: any, from: number = 0, to: number = 19): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  const selectText = "id,order_no,customer_cno,delivery_method,order_date,total_amount,status,is_paid,notes,created_at,updated_at"
  const result: PostgrestSingleResponse<any> = await supabase
    .from("sales_orders")
    .select(selectText, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  return {
    rows: result.data || [],
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizeSales(rows: any[]): any[] {
  return rows.map((row) => ({ ...row }))
}
