"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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

      // 3. 呼叫 RPC：單一交易內完成建立主表、明細、扣庫存
      const { error: rpcError } = await supabase.rpc("create_purchase_return", {
        p_purchase_order_id:     selectedOrder.id,
        p_purchase_order_number: selectedOrder.order_no,
        p_vendor_code:           selectedOrder.supplier_id,
        p_total_amount:          totalAmount,
        p_return_date:           returnDate,
        p_items: itemsToReturn.map(item => ({
          product_id:  String(item.productId),
          quantity:    item.returnQty,
          unit_price:  item.purchasePrice,
          amount:      item.returnQty * item.purchasePrice,
          reason:      item.reason || null,
        })),
      });
      if (rpcError) throw new Error(rpcError.message || "建立進貨退回失敗");

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
      {/* 2. 響應式明細：桌面表格 + 手機卡片 */}
      <div className="w-full mt-4">
        {/* 桌面版表格 (md 以上) */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[30%_15%_15%_15%_25%] bg-muted text-sm font-semibold border-b">
            <div className="py-2 px-3 text-left">商品名稱</div>
            <div className="py-2 px-3 text-right">原進貨數量</div>
            <div className="py-2 px-3 text-right">進價</div>
            <div className="py-2 px-3 text-center">退回數量</div>
            <div className="py-2 px-3 text-center">退回原因</div>
          </div>
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
                    onFocus={e => e.target.select()}
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
        {/* 手機版卡片 (md 以下) */}
        <div className="block md:hidden space-y-4">
          {orderItems.map(item => {
            const ret = returnItems.find(r => r.productId === item.productId);
            return (
              <Card key={item.id} className="shadow-sm bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold truncate">{item.productName}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">原進貨數量</span>
                    <span className="text-right tabular-nums">{item.originalQty}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">進價</span>
                    <span className="text-right tabular-nums">{item.purchasePrice}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-2">
                    <span className="text-gray-500">退回數量</span>
                    <Input
                      type="number"
                      min={0}
                      max={item.originalQty}
                      value={ret?.returnQty ?? ""}
                      onChange={e => handleReturnQtyChange(item.productId, Number(e.target.value))}
                      onFocus={e => e.target.select()}
                      className="h-9 w-20 text-right"
                    />
                  </div>
                  <div className="flex justify-between items-center text-sm mt-2">
                    <span className="text-gray-500">退回原因</span>
                    <Input
                      value={ret?.reason ?? ""}
                      onChange={e => handleReasonChange(item.productId, e.target.value)}
                      className="h-9 w-32 text-left"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
      {/* 3. 儲存按鈕 */}
      <div className="mt-4">
        <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto">儲存</Button>
      </div>
    </div>
  );
}
