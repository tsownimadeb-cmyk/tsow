import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

type SalesOrderRow = {
  id: string
  order_no: string
  customer_cno: string | null
  order_date: string
  total_amount: number | null
}

type SalesItemRow = {
  sales_order_id: string
  code: string | null
  quantity: number | null
  unit_price: number | null
}

type ProductRow = {
  code: string
  name: string | null
}

const normalizeText = (value: unknown) => String(value ?? "").trim()

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const toCellText = (value: unknown) => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const escapeCsvCell = (value: string) => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const toCsv = (rows: Record<string, unknown>[], columns: string[]) => {
  const header = columns.join(",")
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(toCellText(row[column]))).join(",")).join("\r\n")
  return `\uFEFF${header}\r\n${body}`
}

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const customerCode = normalizeText(searchParams.get("customerCode"))
    const startDate = normalizeText(searchParams.get("startDate"))
    const endDate = normalizeText(searchParams.get("endDate"))

    if (!customerCode) {
      return NextResponse.json({ success: false, message: "請先選定客戶再匯出" }, { status: 400 })
    }

    const supabase = await createClient()

    let orderQuery = supabase
      .from("sales_orders")
      .select("id,order_no,customer_cno,order_date,total_amount")
      .eq("customer_cno", customerCode)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })

    if (startDate) {
      orderQuery = orderQuery.gte("order_date", startDate)
    }
    if (endDate) {
      orderQuery = orderQuery.lte("order_date", endDate)
    }

    const { data: salesOrdersData, error: salesOrdersError } = await orderQuery
    if (salesOrdersError) {
      throw new Error(salesOrdersError.message || "讀取銷貨資料失敗")
    }

    const salesOrders = (salesOrdersData || []) as SalesOrderRow[]
    const orderIds = salesOrders.map((order) => normalizeText(order.id)).filter(Boolean)

    const { data: customerData } = await supabase
      .from("customers")
      .select("code,name")
      .eq("code", customerCode)
      .maybeSingle()

    const customerName = normalizeText((customerData as { name?: string | null } | null)?.name) || customerCode

    const { data: salesItemsData, error: salesItemsError } = orderIds.length
      ? await supabase
          .from("sales_order_items")
          .select("sales_order_id,code,quantity,unit_price")
          .in("sales_order_id", orderIds)
      : { data: [] as SalesItemRow[], error: null }

    if (salesItemsError) {
      throw new Error(salesItemsError.message || "讀取銷貨明細失敗")
    }

    const salesItems = (salesItemsData || []) as SalesItemRow[]
    const productCodes = Array.from(new Set(salesItems.map((item) => normalizeText(item.code)).filter(Boolean)))

    const { data: productsData, error: productsError } = productCodes.length
      ? await supabase.from("products").select("code,name").in("code", productCodes)
      : { data: [] as ProductRow[], error: null }

    if (productsError) {
      throw new Error(productsError.message || "讀取商品資料失敗")
    }

    const productMap = new Map(
      ((productsData || []) as ProductRow[]).map((product) => [normalizeText(product.code), normalizeText(product.name) || normalizeText(product.code)]),
    )

    const orderItemsMap = new Map<string, SalesItemRow[]>()
    for (const item of salesItems) {
      const orderId = normalizeText(item.sales_order_id)
      if (!orderId) continue
      const current = orderItemsMap.get(orderId) || []
      current.push(item)
      orderItemsMap.set(orderId, current)
    }

    const timelineRows: Record<string, unknown>[] = salesOrders.map((order) => {
      const orderId = normalizeText(order.id)
      const items = orderItemsMap.get(orderId) || []
      const itemSummary = items.length
        ? items.map((item) => productMap.get(normalizeText(item.code)) || normalizeText(item.code) || "未知商品").join("、")
        : "-"
      const unitPriceSummary = items.length ? items.map((item) => toSafeNumber(item.unit_price)).join("、") : "-"
      const totalQuantity = items.reduce((sum, item) => sum + toSafeNumber(item.quantity), 0)

      return {
        日期: normalizeText(order.order_date),
        客戶: customerName,
        單號: normalizeText(order.order_no),
        品項: itemSummary,
        單價: unitPriceSummary,
        數量: totalQuantity,
        金額: toSafeNumber(order.total_amount),
      }
    })

    const csv = toCsv(timelineRows, ["日期", "客戶", "單號", "品項", "單價", "數量", "金額"])
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = `customer-timeline-${customerCode}-${timestamp}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "匯出失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}