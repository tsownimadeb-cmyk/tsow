import type { PostgrestSingleResponse } from "@supabase/supabase-js"

const ITEM_CHUNK_SIZE = 200

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

function escapeLikeValue(value: string): string {
  return value.replaceAll("%", "\\%").replaceAll(",", "\\,")
}

function quoteInValue(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

export async function fetchSalesRows(
  supabase: any,
  from: number = 0,
  to: number = 19,
  searchText: string = ""
): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  const keyword = searchText.trim()
  const likeKeyword = escapeLikeValue(keyword)
  const selectText = "id,order_no,customer_cno,delivery_method,order_date,total_amount,status,is_paid,notes,created_at,updated_at"
  let query = supabase
    .from("sales_orders")
    .select(selectText, { count: "exact" })
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (keyword !== "") {
    // 兩階段搜尋：先找客戶，再用客戶代號回查銷貨單，避開跨表關聯錯誤
    const { data: matchedCustomers } = await supabase
      .from("customers")
      .select("code")
      .or(`code.ilike.%${likeKeyword}%,name.ilike.%${likeKeyword}%`)
      .limit(200)

    const matchedCodes = (matchedCustomers || [])
      .map((customer: { code?: string | null }) => String(customer.code || "").trim())
      .filter(Boolean)

    const filters = [`order_no.ilike.%${likeKeyword}%`, `customer_cno.ilike.%${likeKeyword}%`, `notes.ilike.%${likeKeyword}%`]

    if (matchedCodes.length > 0) {
      filters.push(`customer_cno.in.(${matchedCodes.map(quoteInValue).join(",")})`)
    }

    query = query.or(filters.join(","))
  }
  const result: PostgrestSingleResponse<any> = await query

  const salesRows = result.data || []
  const salesIds = salesRows.map((row: any) => row.id)
  let itemsBySalesId: Record<string, any[]> = {}

  if (salesIds.length > 0) {
    const salesIdChunks = chunkArray(salesIds, ITEM_CHUNK_SIZE)
    for (const idChunk of salesIdChunks) {
      const itemsResult: PostgrestSingleResponse<any> = await supabase
        .from("sales_order_items")
        .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
        .in("sales_order_id", idChunk)

      if (!itemsResult.data) continue
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
