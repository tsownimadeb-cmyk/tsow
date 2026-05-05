"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import OrderSelector, {
  type SalesOrder as ReturnSalesOrder,
  type SalesOrderItem as ReturnSalesOrderItem,
} from "@/components/sales/order-selector";

export default function SalesReturnsPage() {
  // 狀態設計
  const [selectedOrder, setSelectedOrder] = useState<ReturnSalesOrder | null>(null);
  const [orderItems, setOrderItems] = useState<ReturnSalesOrderItem[]>([]);
  const [returnItems, setReturnItems] = useState<{
    productId: string;
    productName: string;
    originalQty: number;
    salePrice: number;
    returnQty: number;
    reason: string;
  }[]>([]);
  const [saving, setSaving] = useState(false);

  // 處理銷貨單選取
  const handleOrderSelect = (order: ReturnSalesOrder, items: ReturnSalesOrderItem[]) => {
    setSelectedOrder(order);
    setOrderItems(items);
    setReturnItems(items.map(i => ({
      productId: i.productId,
      productName: i.productName,
      originalQty: i.originalQty,
      salePrice: i.salePrice,
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

  // 儲存
  const router = useRouter();

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

      // 2. Insert sales_returns 主表（狀態 completed，正確欄位）
      const totalAmount = itemsToReturn.reduce((sum, item) => sum + (item.returnQty * item.salePrice), 0);

      // 呼叫 RPC：單一交易內完成建立主表、明細、加庫存
      const { error: rpcError } = await supabase.rpc("create_sales_return", {
        p_sales_order_id: selectedOrder.id,
        p_order_number:   selectedOrder.orderNumber,
        p_customer_code:  selectedOrder.customerCode,
        p_total_amount:   totalAmount,
        p_items: itemsToReturn.map(item => ({
          product_code: item.productId,
          quantity:     item.returnQty,
          unit_price:   item.salePrice,
          reason:       item.reason || null,
        })),
      });
      if (rpcError) throw new Error(rpcError.message || "建立銷貨退回失敗");

      toast({ title: "退回成功", description: "銷貨退回已完成。" });
      setTimeout(() => {
        router.push("/sales-returns");
      }, 800);
    } catch (err: any) {
      toast({ title: "儲存失敗", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <h2 className="text-2xl font-bold mb-4">銷貨退回</h2>
      {/* 1. 選取銷貨單 */}
      <OrderSelector onSelect={handleOrderSelect} />
      {/* 2. 響應式明細：桌面表格 + 手機卡片 */}
      <div className="w-full mt-4">
        {/* 桌面版表格 (md 以上) */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[30%_15%_15%_15%_25%] bg-muted text-sm font-semibold border-b">
            <div className="py-2 px-3 text-left">商品名稱</div>
            <div className="py-2 px-3 text-right">原銷貨數量</div>
            <div className="py-2 px-3 text-right">售價</div>
            <div className="py-2 px-3 text-center">退回數量</div>
            <div className="py-2 px-3 text-center">退回原因</div>
          </div>
          {orderItems.map(item => {
            const ret = returnItems.find(r => r.productId === item.productId);
            return (
              <div key={item.id} className="grid grid-cols-[30%_15%_15%_15%_25%] border-b last:border-0 items-center">
                <div className="py-2 px-3 text-left break-all">{item.productName}</div>
                <div className="py-2 px-3 text-right tabular-nums">{item.originalQty}</div>
                <div className="py-2 px-3 text-right tabular-nums">{item.salePrice}</div>
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
                    <span className="text-gray-500">原銷貨數量</span>
                    <span className="text-right tabular-nums">{item.originalQty}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">售價</span>
                    <span className="text-right tabular-nums">{item.salePrice}</span>
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
                    <span className="text-gray-500 shrink-0">退回原因</span>
                    <Input
                      value={ret?.reason ?? ""}
                      onChange={e => handleReasonChange(item.productId, e.target.value)}
                      className="h-9 flex-1 ml-3 text-left"
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
