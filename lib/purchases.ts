
import type { PostgrestSingleResponse } from "@supabase/supabase-js"

export async function fetchPurchasesRows(
  supabase: any,
  from: number = 0,
  to: number = 19,
  searchText: string = ""
): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  // 查詢進貨單主檔
  const selectText = "id,order_no,supplier_id,order_date,total_amount,shipping_fee,status,is_paid,notes,created_at,updated_at"
  let query = supabase
    .from("purchase_orders")
    .select(selectText, { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (searchText && searchText.trim() !== "") {
    // 搜尋 order_no、notes（備註）、供應商名稱
    // 先查詢符合名稱的 supplier id
    const { data: supplierMatches } = await supabase
      .from("suppliers")
      .select("id")
      .ilike("name", `%${searchText}%`)
    const supplierIds = (supplierMatches || []).map((s: any) => s.id)
    // 組合搜尋條件
    let orConditions = [`order_no.ilike.%${searchText}%`, `notes.ilike.%${searchText}%`]
    if (supplierIds.length > 0) {
      orConditions.push(`supplier_id.in.(${supplierIds.join(",")})`)
    }
    query = query.or(orConditions.join(","))
  }
  const result: PostgrestSingleResponse<any> = await query.range(from, to)

  const purchaseRows = result.data || []
  const purchaseIds = purchaseRows.map((row: any) => row.id)
  let itemsByPurchaseId: Record<string, any[]> = {}

  if (purchaseIds.length > 0) {
    // 查詢所有明細
    const itemsResult: PostgrestSingleResponse<any> = await supabase
      .from("purchase_order_items")
      .select("id,purchase_order_id,order_no,code,quantity,unit_price,subtotal,created_at")
      .in("purchase_order_id", purchaseIds)

    if (itemsResult.data) {
      for (const item of itemsResult.data) {
        if (!itemsByPurchaseId[item.purchase_order_id]) itemsByPurchaseId[item.purchase_order_id] = []
        itemsByPurchaseId[item.purchase_order_id].push(item)
      }
    }
  }

  // 將明細組合到主檔
  const rowsWithItems = purchaseRows.map((row: any) => ({
    ...row,
    items: itemsByPurchaseId[row.id] || [],
  }))

  return {
    rows: rowsWithItems,
    totalCount: result.count ?? 0,
    warning: result.error?.message || null,
  }
}

export function normalizePurchases(rows: any[]): any[] {
  // 保持原本結構，未來可擴充
  return rows.map((row) => ({ ...row }))
}
