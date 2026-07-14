import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"
import {
  calculateProductStock,
  fetchAllRows,
  type PurchaseReturnStockItemRow,
  type PurchaseStockItemRow,
  type SalesReturnStockItemRow,
  type SalesStockItemRow,
  type StockOrderRow,
  type StockProductRow,
  type StockReturnRow,
} from "@/lib/stock-recalculation"

// 重新計算所有商品庫存
export async function POST(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  let writeStarted = false

  try {
    const supabase = await createClient()

    // 每張表都以穩定欄位分頁讀取，避免 PostgREST 單次回傳上限造成漏算。
    const [
      products,
      purchaseOrders,
      purchaseItems,
      salesOrders,
      salesItems,
      purchaseReturns,
      purchaseReturnItems,
      salesReturns,
      salesReturnItems,
    ] = await Promise.all([
      fetchAllRows<StockProductRow>(supabase, {
        table: "products",
        select: "code",
        orderBy: "code",
        label: "取得商品清單",
      }),
      fetchAllRows<StockOrderRow>(supabase, {
        table: "purchase_orders",
        select: "id,order_no,status",
        orderBy: "id",
        label: "取得進貨單",
      }),
      fetchAllRows<PurchaseStockItemRow>(supabase, {
        table: "purchase_order_items",
        select: "id,purchase_order_id,order_no,code,quantity",
        orderBy: "id",
        label: "取得進貨明細",
      }),
      fetchAllRows<StockOrderRow>(supabase, {
        table: "sales_orders",
        select: "id,order_no,status",
        orderBy: "id",
        label: "取得銷貨單",
      }),
      fetchAllRows<SalesStockItemRow>(supabase, {
        table: "sales_order_items",
        select: "id,sales_order_id,code,quantity",
        orderBy: "id",
        label: "取得銷貨明細",
      }),
      fetchAllRows<StockReturnRow>(supabase, {
        table: "purchase_returns",
        select: "id,status",
        orderBy: "id",
        label: "取得進貨退回單",
      }),
      fetchAllRows<PurchaseReturnStockItemRow>(supabase, {
        table: "purchase_return_items",
        select: "id,purchase_return_id,product_id,quantity",
        orderBy: "id",
        label: "取得進貨退回明細",
      }),
      fetchAllRows<StockReturnRow>(supabase, {
        table: "sales_returns",
        select: "id,status",
        orderBy: "id",
        label: "取得銷貨退回單",
      }),
      fetchAllRows<SalesReturnStockItemRow>(supabase, {
        table: "sales_return_items",
        select: "id,sales_return_id,product_code,quantity",
        orderBy: "id",
        label: "取得銷貨退回明細",
      }),
    ])

    if (products.length === 0) {
      return NextResponse.json({ success: false, message: "沒有商品可重算" }, { status: 400 })
    }

    // 先在記憶體完成全部驗證與計算；任何資料問題都會在寫入前中止。
    const { updates, stats } = calculateProductStock({
      products,
      purchaseOrders,
      purchaseItems,
      salesOrders,
      salesItems,
      purchaseReturns,
      purchaseReturnItems,
      salesReturns,
      salesReturnItems,
    })

    const updatedAt = new Date().toISOString()

    // 一次 bulk upsert 會由 PostgreSQL 以單一 statement 執行：全部成功或全部失敗，
    // 不再發生逐筆更新到一半後留下部分新庫存的情況。
    writeStarted = true
    const { error: updateError, count: updateCount } = await supabase
      .from("products")
      .upsert(
        updates.map((update) => ({ ...update, updated_at: updatedAt })),
        {
          onConflict: "code",
          ignoreDuplicates: false,
          count: "exact",
          defaultToNull: false,
        },
      )

    if (updateError) {
      return NextResponse.json(
        { success: false, message: "更新商品庫存失敗，沒有套用任何變更", error: updateError.message },
        { status: 500 },
      )
    }

    if (updateCount !== updates.length) {
      return NextResponse.json(
        {
          success: false,
          message: "商品庫存寫入筆數驗證失敗，請勿繼續操作並重新檢查資料",
          expected: updates.length,
          actual: updateCount,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      updated: updateCount,
      stats,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        success: false,
        message: writeStarted
          ? "庫存寫入結果無法確認；請先重新整理並核對庫存，再決定是否重試"
          : "庫存重算失敗，沒有套用任何變更",
        error: message,
      },
      { status: 500 },
    )
  }
}
