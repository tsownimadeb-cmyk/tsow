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
      {/* 2. 明細表格 */}
      <Table>
        <thead>
          <tr>
            <th>商品名稱</th>
            <th>原進貨數量</th>
            <th>進價</th>
            <th>退回數量</th>
            <th>退回原因</th>
          </tr>
        </thead>
        <TableBody>
          {orderItems.map(item => (
            <TableRow key={item.productId}>
              <TableCell>{item.productName}</TableCell>
              <TableCell>{item.originalQty}</TableCell>
              <TableCell>{item.purchasePrice}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={0}
                  max={item.originalQty}
                  value={returnItems.find(r => r.productId === item.productId)?.returnQty || ""}
                  onChange={e => handleReturnQtyChange(item.productId, Number(e.target.value))}
                />
              </TableCell>
              <TableCell>
                <Input
                  value={returnItems.find(r => r.productId === item.productId)?.reason || ""}
                  onChange={e => handleReasonChange(item.productId, e.target.value)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* 3. 儲存按鈕 */}
      <Button onClick={handleSave} disabled={saving}>儲存</Button>
    </div>
  );
}
