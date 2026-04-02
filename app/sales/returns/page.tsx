"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
// 假設有 OrderSelector 元件
import OrderSelector from "@/components/sales/order-selector";

// 型別定義
// 可根據實際 sales_orders 結構調整

type SalesOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  // ...其他欄位
};

type SalesOrderItem = {
  id: string;
  productId: string;
  productName: string;
  originalQty: number;
  salePrice: number;
  // ...其他欄位
};

export default function SalesReturnsPage() {
  // 狀態設計
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [orderItems, setOrderItems] = useState<SalesOrderItem[]>([]);
  const [returnItems, setReturnItems] = useState<{
    productId: string;
    productName: string;
    originalQty: number;
    salePrice: number;
    returnQty: number;
    reason: string;
  }[]>([]);
  const [saving, setSaving] = useState(false);
  // 銷貨單選項（AutoComplete）
  const [orderOptions, setOrderOptions] = useState<SalesOrder[]>([]);

  // 處理銷貨單選取
  const handleOrderSelect = (order: SalesOrder, items: SalesOrderItem[]) => {
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
  const router = typeof window !== "undefined" ? require("next/navigation").useRouter() : null;

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

      toast({ title: "退回成功", description: "銷貨退回已完成。", variant: "success" });
      setTimeout(() => {
        if (router) router.push("/sales");
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
      {/* 2. 明細表格（Grid 版） */}
      <div className="w-full mt-4">
        {/* 表頭 */}
        <div className="grid grid-cols-[30%_15%_15%_15%_25%] bg-muted text-sm font-semibold border-b">
          <div className="py-2 px-3 text-left">商品名稱</div>
          <div className="py-2 px-3 text-right">原銷貨數量</div>
          <div className="py-2 px-3 text-right">售價</div>
          <div className="py-2 px-3 text-center">退回數量</div>
          <div className="py-2 px-3 text-center">退回原因</div>
        </div>
        {/* 內容 */}
        {orderItems.map(item => {
          const ret = returnItems.find(r => r.productId === item.productId) || {};
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
                  value={ret.returnQty ?? ""}
                  onChange={e => handleReturnQtyChange(item.productId, Number(e.target.value))}
                  className="h-9 w-full text-right"
                  style={{ maxWidth: 80 }}
                />
              </div>
              <div className="py-2 px-3 flex items-center">
                <Input
                  value={ret.reason ?? ""}
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
