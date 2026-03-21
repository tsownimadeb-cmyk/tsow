import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 進貨退回 API
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { purchaseOrderId, supplierId, returnDate, items, notes } = body;
  // items: [{ productPno, quantity, unitPrice, amount, reason }]
  if (!purchaseOrderId || !supplierId || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, message: "資料不完整" }, { status: 400 });
  }
  const supabase = await createClient();
  const client = supabase; // 若有 transaction 支援可改用 client.transaction

  try {
    // 1. 新增 purchase_returns
    const { data: returnRow, error: returnError } = await client
      .from("purchase_returns")
      .insert({
        purchase_order_id: purchaseOrderId,
        supplier_id: supplierId,
        return_date: returnDate || new Date().toISOString().slice(0, 10),
        total_amount: items.reduce((sum, i) => sum + Number(i.amount), 0),
        notes: notes || null,
      })
      .select()
      .single();
    if (returnError || !returnRow) {
      return NextResponse.json({ success: false, message: returnError?.message || "新增退貨主檔失敗" }, { status: 500 });
    }
    const purchaseReturnId = returnRow.id;

    // 2. 新增 purchase_return_items
    const returnItems = items.map((item: any) => ({
      purchase_return_id: purchaseReturnId,
      product_pno: item.productPno,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: item.amount,
      reason: item.reason || null,
    }));
    const { error: itemsError } = await client.from("purchase_return_items").insert(returnItems);
    if (itemsError) {
      return NextResponse.json({ success: false, message: itemsError.message || "新增退貨明細失敗" }, { status: 500 });
    }

    // 3. 更新 products 庫存（先查詢再 update）
    for (const item of items) {
      const { data: product, error: fetchError } = await client
        .from("products")
        .select("stock_quantity")
        .eq("pno", item.productPno)
        .single();
      if (fetchError) {
        return NextResponse.json({ success: false, message: fetchError.message || "查詢庫存失敗" }, { status: 500 });
      }
      const newQty = (product?.stock_quantity || 0) - item.quantity;
      const { error: stockError } = await client
        .from("products")
        .update({ stock_quantity: newQty })
        .eq("pno", item.productPno);
      if (stockError) {
        return NextResponse.json({ success: false, message: stockError.message || "更新庫存失敗" }, { status: 500 });
      }
    }

    // 4. 新增 accounts_payable（負數金額）
    const totalAmount = items.reduce((sum, i) => sum + Number(i.amount), 0);
    const { error: apError } = await client.from("accounts_payable").insert({
      purchase_order_id: purchaseOrderId,
      supplier_id: supplierId,
      amount_due: -totalAmount,
      paid_amount: 0,
      status: "unpaid",
      notes: "進貨退回沖帳",
    });
    if (apError) {
      return NextResponse.json({ success: false, message: apError.message || "新增應付帳款失敗" }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: purchaseReturnId });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message || "退貨失敗" }, { status: 500 });
  }
}
