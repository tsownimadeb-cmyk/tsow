import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// 重新計算所有商品庫存
export async function POST() {
  try {
    const supabase = await createClient()

    // 權限測試：嘗試查詢一筆商品資料
    const { data: test, error: testError } = await supabase.from("products").select("*").limit(1)
    // @ts-ignore
    // eslint-disable-next-line no-console
    console.log("testError", testError, "test", test)

    // 取得所有商品編號
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("code")
      .order("code", { ascending: true })
      .limit(10000)

    if (productsError) {
      return NextResponse.json({ success: false, message: "取得商品清單失敗", error: productsError.message }, { status: 500 })
    }

    const codes = (products || []).map((p: any) => p.code)
    if (codes.length === 0) {
      return NextResponse.json({ success: false, message: "沒有商品可重算" }, { status: 400 })
    }

    // 取得所有進貨與銷貨明細
    const { data: purchaseItems, error: purchaseError } = await supabase
      .from("purchase_order_items")
      .select("code,quantity")
      .in("code", codes)
      .limit(100000)
    if (purchaseError) {
      return NextResponse.json({ success: false, message: "取得進貨明細失敗", error: purchaseError.message }, { status: 500 })
    }

    const { data: salesItems, error: salesError } = await supabase
      .from("sales_order_items")
      .select("code,quantity")
      .in("code", codes)
      .limit(100000)
    if (salesError) {
      return NextResponse.json({ success: false, message: "取得銷貨明細失敗", error: salesError.message }, { status: 500 })
    }

    // 計算每個商品的進貨總量與銷貨總量
    const purchaseMap: Record<string, number> = {}
    for (const item of purchaseItems || []) {
      const code = String(item.code || "").trim().toUpperCase()
      const qty = Number(item.quantity) || 0
      purchaseMap[code] = (purchaseMap[code] || 0) + qty
    }
    const salesMap: Record<string, number> = {}
    for (const item of salesItems || []) {
      const code = String(item.code || "").trim().toUpperCase()
      const qty = Number(item.quantity) || 0
      salesMap[code] = (salesMap[code] || 0) + qty
    }

    // 更新每個商品的庫存數量
    let updateCount = 0
    for (const code of codes) {
      const inQty = purchaseMap[code.toUpperCase()] || 0
      const outQty = salesMap[code.toUpperCase()] || 0
      const stockQty = inQty - outQty
      const { error: updateError } = await supabase
        .from("products")
        .update({ stock_qty: stockQty, purchase_qty_total: inQty })
        .eq("code", code)
      if (!updateError) updateCount++
    }

    return NextResponse.json({ success: true, updated: updateCount })
  } catch (err: any) {
    return NextResponse.json({ success: false, message: "API exception", error: String(err?.message || err) }, { status: 500 })
  }
}
