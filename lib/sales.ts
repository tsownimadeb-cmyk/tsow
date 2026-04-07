import type { PostgrestSingleResponse } from "@supabase/supabase-js"

const ITEM_CHUNK_SIZE = 200
const ORDER_FILTER_CHUNK_SIZE = 50
const MATCH_QUERY_PAGE_SIZE = 1000

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

function getTimeValue(value: unknown): number {
  const parsed = value ? new Date(String(value)).getTime() : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function buildOrderKeywordFilters(likeKeyword: string, matchedCodes: string[]): string[] {
  const filters = [`order_no.ilike.%${likeKeyword}%`, `customer_cno.ilike.%${likeKeyword}%`, `notes.ilike.%${likeKeyword}%`]

  if (matchedCodes.length > 0) {
    filters.push(`customer_cno.in.(${matchedCodes.map(quoteInValue).join(",")})`)
  }

  return filters
}

function sortSalesRows(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const orderDateDiff = getTimeValue(b.order_date) - getTimeValue(a.order_date)
    if (orderDateDiff !== 0) return orderDateDiff
    return getTimeValue(b.created_at) - getTimeValue(a.created_at)
  })
}

async function findMatchingCustomerCodes(supabase: any, likeKeyword: string): Promise<string[]> {
  const { data: matchedCustomers } = await supabase
    .from("customers")
    .select("code")
    .or(`code.ilike.%${likeKeyword}%,name.ilike.%${likeKeyword}%`)
    .limit(200)

  return (matchedCustomers || [])
    .map((customer: { code?: string | null }) => String(customer.code || "").trim())
    .filter(Boolean)
}

async function findMatchingSalesOrderIdsByProduct(
  supabase: any,
  productKeyword: string,
): Promise<{ orderIds: string[]; warning: string | null }> {
  const likeKeyword = escapeLikeValue(productKeyword)
  let warning: string | null = null

  const { data: matchedProducts, error: productsError } = await supabase
    .from("products")
    .select("code")
    .or(`code.ilike.%${likeKeyword}%,name.ilike.%${likeKeyword}%`)
    .limit(200)

  if (productsError) {
    warning = productsError.message || warning
  }

  const matchedCodes: string[] = Array.from(
    new Set(
      (matchedProducts || [])
        .map((product: { code?: string | null }) => String(product.code || "").trim())
        .filter(Boolean),
    ),
  )

  const filters = [`code.ilike.%${likeKeyword}%`]
  if (matchedCodes.length > 0) {
    filters.push(`code.in.(${matchedCodes.map(quoteInValue).join(",")})`)
  }

  const orderIds = new Set<string>()

  for (let rangeFrom = 0; ; rangeFrom += MATCH_QUERY_PAGE_SIZE) {
    const rangeTo = rangeFrom + MATCH_QUERY_PAGE_SIZE - 1
    const itemsResult: PostgrestSingleResponse<any> = await supabase
      .from("sales_order_items")
      .select("sales_order_id")
      .or(filters.join(","))
      .range(rangeFrom, rangeTo)

    if (itemsResult.error) {
      warning = itemsResult.error.message || warning
      break
    }

    const batch = itemsResult.data || []
    for (const item of batch) {
      const salesOrderId = String(item.sales_order_id || "").trim()
      if (salesOrderId) orderIds.add(salesOrderId)
    }

    if (batch.length < MATCH_QUERY_PAGE_SIZE) {
      break
    }
  }

  return {
    orderIds: Array.from(orderIds),
    warning,
  }
}

export async function fetchSalesRows(
  supabase: any,
  from: number = 0,
  to: number = 19,
  searchText: string = "",
  productSearchText: string = "",
): Promise<{ rows: any[]; totalCount: number; warning: string | null }> {
  const keyword = searchText.trim()
  const productKeyword = productSearchText.trim()
  const likeKeyword = escapeLikeValue(keyword)
  const selectText = "id,order_no,customer_cno,delivery_method,order_date,total_amount,status,is_paid,notes,created_at,updated_at"
  let warning: string | null = null

  const matchedCustomerCodes = keyword !== "" ? await findMatchingCustomerCodes(supabase, likeKeyword) : []
  const keywordFilters = keyword !== "" ? buildOrderKeywordFilters(likeKeyword, matchedCustomerCodes) : []

  let salesRows: any[] = []
  let totalCount = 0

  if (productKeyword !== "") {
    const { orderIds, warning: productWarning } = await findMatchingSalesOrderIdsByProduct(supabase, productKeyword)
    warning = productWarning || warning

    if (orderIds.length === 0) {
      return {
        rows: [],
        totalCount: 0,
        warning,
      }
    }

    const rowMap = new Map<string, any>()
    const salesIdChunks = chunkArray(orderIds, ORDER_FILTER_CHUNK_SIZE)

    for (const idChunk of salesIdChunks) {
      let chunkQuery = supabase.from("sales_orders").select(selectText).in("id", idChunk)

      if (keywordFilters.length > 0) {
        chunkQuery = chunkQuery.or(keywordFilters.join(","))
      }

      const chunkResult: PostgrestSingleResponse<any> = await chunkQuery

      if (chunkResult.error) {
        warning = chunkResult.error.message || warning
        continue
      }

      for (const row of chunkResult.data || []) {
        rowMap.set(String(row.id), row)
      }
    }

    const sortedRows = sortSalesRows(Array.from(rowMap.values()))
    totalCount = sortedRows.length
    salesRows = sortedRows.slice(from, to + 1)
  } else {
    let query = supabase
      .from("sales_orders")
      .select(selectText, { count: "exact" })
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to)

    if (keywordFilters.length > 0) {
      query = query.or(keywordFilters.join(","))
    }

    const result: PostgrestSingleResponse<any> = await query
    salesRows = result.data || []
    totalCount = result.count ?? 0
    warning = result.error?.message || warning
  }

  const salesIds = salesRows.map((row: any) => row.id)
  const itemsBySalesId: Record<string, any[]> = {}

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
    totalCount,
    warning,
  }
}

export function normalizeSales(rows: any[]): any[] {
  return rows.map((row) => ({ ...row }))
}
