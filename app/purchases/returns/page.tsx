"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// 假設有 OrderSelector 元件
import OrderSelector from "@/components/purchases/order-selector";

// 型別定義
type PurchaseOrder = {
  id: string;
  order_no: string;
  supplier_id: string;
  order_date: string;
  supplier_name?: string;
};

type PurchaseOrderItem = {
  id: string;
  productId: string;
  productName: string;
  originalQty: number;
  purchasePrice: number;
  // ...其他欄位
};

export default function PurchaseReturnsPage() {
  const router = useRouter();

  // 狀態設計
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [orderItems, setOrderItems] = useState<PurchaseOrderItem[]>([]);
  const [returnItems, setReturnItems] = useState<{
    productId: string;
    productName: string;
    originalQty: number;
    purchasePrice: number;
    returnQty: number;
    reason: string;
  }[]>([]);
  const [saving, setSaving] = useState(false);

  // 處理進貨單選取
  const handleOrderSelect = (order: PurchaseOrder, items: PurchaseOrderItem[]) => {
    setSelectedOrder(order);
    setOrderItems(items);
    setReturnItems(items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      originalQty: i.originalQty,
      purchasePrice: i.purchasePrice,
      returnQty: 0,
      reason: "",
    })));
  };

  // 處理退回數量變更
  const handleReturnQtyChange = (productId: string, qty: number) => {
    setReturnItems(prev => prev.map(item =>
      item.productId === productId ? { ...item, returnQty: qty } : item
    ));
  };

  // 處理退回原因變更
  const handleReasonChange = (productId: string, reason: string) => {
    setReturnItems(prev => prev.map(item =>
      item.productId === productId ? { ...item, reason } : item
    ));
  };

  const handleSave = async () => {
    if (!selectedOrder) return;
    setSaving(true);
    const supabase = createClient();
    try {
      // 1. 過濾有退回的明細
      const itemsToReturn = returnItems.filter(item => Number(item.returnQty) > 0);
      if (itemsToReturn.length === 0) {
        toast({ title: "請輸入退回數量", description: "至少需有一項商品退回。", variant: "destructive" });
        setSaving(false);
        return;
      }

      // 2. 計算總金額
      const totalAmount = itemsToReturn.reduce((sum, item) => sum + (item.returnQty * item.purchasePrice), 0);
      const today = new Date();
      const returnDate = today.toISOString().slice(0, 10);

      // 3. Insert purchase_returns 主表

      const { data: returnMain, error: returnMainError } = await supabase
        .from("purchase_returns")
        .insert([
          {
            purchase_order_id: selectedOrder.id,
            purchase_order_number: selectedOrder.order_no,
            vendor_code: selectedOrder.supplier_id,
            total_amount: totalAmount,
            return_date: returnDate,
            status: "completed",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select();
      if (returnMainError || !returnMain || !returnMain[0]) {
        throw new Error(returnMainError?.message || "建立退回主表失敗");
      }
      const purchaseReturnId = returnMain[0].id;

      // 4. Insert purchase_return_items 明細（product_id TEXT，統一欄位）
      const itemsPayload = itemsToReturn.map(item => ({
        purchase_return_id: purchaseReturnId,
        product_id: String(item.productId),
        quantity: item.returnQty,
        unit_price: item.purchasePrice,
        amount: item.returnQty * item.purchasePrice,
        reason: item.reason,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error: itemsError } = await supabase
        .from("purchase_return_items")
        .insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message || "退回明細寫入失敗");

      // 5. 更新 products 的庫存（扣除退回數量，product_id 為字串）
      for (const item of itemsToReturn) {
        const { data: productData, error: selectError } = await supabase
          .from("products")
          .select("stock_qty")
          .eq("code", item.productId)
          .single();
        if (selectError || !productData) throw new Error(selectError?.message || `無法查詢商品 ${item.productName}`);
        const newStockQty = (productData.stock_qty || 0) - item.returnQty;
        const { error: updateError } = await supabase
          .from("products")
          .update({ stock_qty: newStockQty, updated_at: new Date().toISOString() })
          .eq("code", item.productId);
        if (updateError) throw new Error(updateError.message || `商品 ${item.productName} 庫存更新失敗`);
      }

      toast({ title: "退回成功", description: "進貨退回已完成。" });
      setTimeout(() => {
        router.push("/purchase-returns");
      }, 800);
    } catch (err: any) {
      toast({ title: "儲存失敗", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">進貨退回</h2>
      {/* 1. 選取進貨單 */}
      <OrderSelector onSelect={handleOrderSelect} />
      {/* 2. 明細表格（Grid 版） */}
      <div className="w-full mt-4">
        {/* 表頭 */}
        <div className="grid grid-cols-[30%_15%_15%_15%_25%] bg-muted text-sm font-semibold border-b">
          <div className="py-2 px-3 text-left">商品名稱</div>
          <div className="py-2 px-3 text-right">原進貨數量</div>
          <div className="py-2 px-3 text-right">進價</div>
          <div className="py-2 px-3 text-center">退回數量</div>
          <div className="py-2 px-3 text-center">退回原因</div>
        </div>
        {/* 內容 */}
        {orderItems.map(item => {
          const ret = returnItems.find(r => r.productId === item.productId);
          return (
            <div key={item.id} className="grid grid-cols-[30%_15%_15%_15%_25%] border-b last:border-0 items-center">
              <div className="py-2 px-3 text-left break-all">{item.productName}</div>
              <div className="py-2 px-3 text-right tabular-nums">{item.originalQty}</div>
              <div className="py-2 px-3 text-right tabular-nums">{item.purchasePrice}</div>
              <div className="py-2 px-3 flex justify-center items-center">
                <Input
                  type="number"
                  min={0}
                  max={item.originalQty}
                  value={ret?.returnQty ?? ""}
                  onChange={e => handleReturnQtyChange(item.productId, Number(e.target.value))}
                  className="h-9 w-full text-right"
                  style={{ maxWidth: 80 }}
                />
              </div>
              <div className="py-2 px-3 flex items-center">
                <Input
                  value={ret?.reason ?? ""}
                  onChange={e => handleReasonChange(item.productId, e.target.value)}
                  className="h-9 w-full text-left"
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* 3. 儲存按鈕 */}
      <Button onClick={handleSave} disabled={saving}>儲存</Button>
    </div>
  );
}
