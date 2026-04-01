"use client";


import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
// 假設有 OrderSelector 元件
import OrderSelector from "@/components/purchases/order-selector";

// 型別定義
type PurchaseOrder = {
  id: string;
  orderNumber: string;
  supplierName: string;
  // ...其他欄位
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
  // 進貨單選項（AutoComplete）
  const [orderOptions, setOrderOptions] = useState<PurchaseOrder[]>([]);

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

  // 儲存
  const handleSave = async () => {
    setSaving(true);
    // TODO: 呼叫 API 實作
    setSaving(false);
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
          const ret = returnItems.find(r => r.productId === item.productId) || {};
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
