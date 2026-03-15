
import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchCustomersRows(
  supabase: any,
  from: number = 0,
  to: number = 19,
  searchText: string = ""
): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  // 僅查詢 customers 基本資料，避免 schema cache 關聯錯誤
  const selectText = "*"
  let query = supabase
    .from("customers")
    .select(selectText, { count: "exact" })
    .order("code")
    .range(from, to)

  if (searchText && searchText.trim() !== "") {
    query = query.or(`name.ilike.%${searchText}%,code.ilike.%${searchText}%`)
  }
  const result: PostgrestSingleResponse<any> = await query

  return {
    rows: result.data || [],
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizeCustomers(rows: any[]): any[] {
  return rows.map((row) => ({ ...row }))
}
