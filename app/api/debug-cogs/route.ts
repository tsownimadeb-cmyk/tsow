import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get("code") || "F008").trim().toUpperCase()

  const supabase = await createClient()

  // 1. All purchase_order_items for this code
  const { data: purchaseItemsByCode, error: e1 } = await supabase
    .from("purchase_order_items")
    .select("purchase_order_id,code,quantity,unit_price,subtotal")
    .eq("code", code)
    .limit(50000)

  const totalPurchasedQty = (purchaseItemsByCode || []).reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0)

  // 2. All sales_order_items for this code
  const { data: salesItemsByCode, error: e2 } = await supabase
    .from("sales_order_items")
    .select("sales_order_id,code,quantity,unit_price,subtotal")
    .eq("code", code)
    .limit(50000)

  const totalSoldQty = (salesItemsByCode || []).reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0)

  // 3. Get sales_orders for dates and status
  const salesOrderIds = Array.from(new Set((salesItemsByCode || []).map((r: any) => r.sales_order_id)))
  const { data: salesOrdersData, error: e3 } = salesOrderIds.length
    ? await (supabase.from("sales_orders").select("id,order_date,status").in("id", salesOrderIds as string[]).limit(50000))
    : { data: [], error: null }

  const cancelledIds = (salesOrdersData || [])
    .filter((o: any) => String(o.status || "").toLowerCase() === "cancelled")
    .map((o: any) => o.id)
  const totalActiveSoldQty = (salesItemsByCode || [])
    .filter((r: any) => !cancelledIds.includes(r.sales_order_id))
    .reduce((sum: number, r: any) => sum + Number(r.quantity || 0), 0)

  const orderDateMap = Object.fromEntries((salesOrdersData || []).map((o: any) => [o.id, o.order_date]))
  const salesWithDates = (salesItemsByCode || [])
    .map((r: any) => ({
      ...r,
      order_date: orderDateMap[r.sales_order_id] || null,
      status: (salesOrdersData || []).find((o: any) => o.id === r.sales_order_id)?.status || null,
    }))
    .sort((a: any, b: any) => String(a.order_date || "").localeCompare(String(b.order_date || "")))

  return NextResponse.json({
    searchedCode: code,
    summary: {
      totalPurchasedQty,
      totalSoldQty,
      totalActiveSoldQty,
      fifoDepletedBeforePeriod: totalActiveSoldQty > totalPurchasedQty,
    },
    purchaseItemsByCode,
    purchaseError: e1?.message,
    salesItemsWithDates: salesWithDates,
    salesError: e2?.message,
    salesOrdersError: e3?.message,
  })
}
