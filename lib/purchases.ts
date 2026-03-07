import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchPurchasesRows(supabase: any, from: number = 0, to: number = 19): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  // 你可以根據實際欄位調整 select 欄位
  const selectText = "id,order_no,supplier_id,order_date,total_amount,shipping_fee,status,is_paid,notes,created_at,updated_at"
  const result: PostgrestSingleResponse<any> = await supabase
    .from("purchase_orders")
    .select(selectText, { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  return {
    rows: result.data || [],
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizePurchases(rows: any[]): any[] {
  // 若有更複雜的正規化邏輯請自行補上
  return rows.map((row) => ({ ...row }))
}
