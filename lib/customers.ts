
import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchCustomersRows(supabase: any, from: number = 0, to: number = 19): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  const selectText = "*"
  const result: PostgrestSingleResponse<any> = await supabase
    .from("customers")
    .select(selectText, { count: "exact" })
    .order("code")
    .range(from, to)

  return {
    rows: result.data || [],
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizeCustomers(rows: any[]): any[] {
  return rows.map((row) => ({ ...row }))
}
