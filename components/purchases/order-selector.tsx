import React from "react";

// 假資料型別，實際可根據 props 傳入型別調整
interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierName: string;
}
interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  originalQty: number;
  purchasePrice: number;
}

interface OrderSelectorProps {
  onSelect: (order: PurchaseOrder, items: PurchaseOrderItem[]) => void;
}

// 簡易元件範例，實際可串接 API 或 AutoComplete
const mockOrders: PurchaseOrder[] = [
  { id: "1", orderNumber: "PO-001", supplierName: "供應商A" },
  { id: "2", orderNumber: "PO-002", supplierName: "供應商B" },
];
const mockItems: PurchaseOrderItem[] = [
  { id: "a", productId: "p1", productName: "商品A", originalQty: 10, purchasePrice: 100 },
  { id: "b", productId: "p2", productName: "商品B", originalQty: 5, purchasePrice: 200 },
];

export default function OrderSelector({ onSelect }: OrderSelectorProps) {
  return (
    <div className="mb-4">
      <select
        className="border rounded px-2 py-1"
        defaultValue=""
        onChange={e => {
          const order = mockOrders.find(o => o.id === e.target.value);
          if (order) onSelect(order, mockItems);
        }}
      >
        <option value="" disabled>
          請選擇進貨單
        </option>
        {mockOrders.map(order => (
          <option key={order.id} value={order.id}>
            {order.orderNumber} - {order.supplierName}
          </option>
        ))}
      </select>
    </div>
  );
}
