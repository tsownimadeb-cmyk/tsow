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
      const { data: returnMain, error: returnMainError } = await supabase
        .from("sales_returns")
        .insert([
          {
            sales_order_id: selectedOrder.id,
            order_number: selectedOrder.orderNumber, // 銷貨單號
            customer_code: selectedOrder.customerCode, // 客戶編號
            status: "completed",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select();
      if (returnMainError || !returnMain || !returnMain[0]) {
        throw new Error(returnMainError?.message || "建立退回主表失敗");
      }
      const salesReturnId = returnMain[0].id;

      // 3. Insert sales_return_items 明細表（正確欄位）
      const itemsPayload = itemsToReturn.map(item => ({
        sales_return_id: salesReturnId,
        product_code: item.productId,
        quantity: item.returnQty,
        unit_price: item.salePrice,
        reason: item.reason,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { error: itemsError } = await supabase
        .from("sales_return_items")
        .insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message || "退回明細寫入失敗");

      // 4. 更新 products 的庫存（加回退回數量）
      for (const item of itemsToReturn) {
        // 先查出當前庫存
        const { data: productData, error: selectError } = await supabase
          .from("products")
          .select("stock_qty")
          .eq("code", item.productId)
          .single();
        if (selectError || !productData) throw new Error(selectError?.message || `無法查詢商品 ${item.productName}`);
        
        // 計算新庫存
        const newStockQty = (productData.stock_qty || 0) + item.returnQty;
        
        // 更新庫存
        const { error: updateError } = await supabase
          .from("products")
          .update({ stock_qty: newStockQty, updated_at: new Date().toISOString() })
          .eq("code", item.productId);
        if (updateError) throw new Error(updateError.message || `商品 ${item.productName} 庫存更新失敗`);
      }

      toast({ title: "退回成功", description: "銷貨退回已完成。" });
      setTimeout(() => {
        router.push("/sales");
      }, 800);
    } catch (err: any) {
      toast({ title: "儲存失敗", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
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
