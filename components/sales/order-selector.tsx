// TODO: 實作銷貨單選擇元件，參考進貨單 OrderSelector
// 這裡僅為樣板，需串接實際銷貨單資料
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SalesOrder = {
  id: string;
  orderDate: string;
  customerCno: string;
};

type SalesOrderItem = {
  id: string;
  productId: string;
  productName: string;
  originalQty: number;
  salePrice: number;
};

export default function OrderSelector({ onSelect }: {
  onSelect: (order: SalesOrder, items: SalesOrderItem[]) => void;
}) {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");

  useEffect(() => {
    // 載入銷貨單列表與客戶姓名（從 Supabase）
    const fetchOrdersAndCustomers = async () => {
      const supabase = createClient();
      // 1. 先查銷貨單
      const { data: orderData, error: orderError } = await supabase
        .from("sales_orders")
        .select("id, order_no, customer_cno, order_date")
        .order("order_date", { ascending: false });
      if (orderError || !orderData) return;

      setOrders(
        orderData.map((o: any) => ({
          id: o.id,
          orderDate: o.order_date,
          customerCno: o.customer_cno,
        }))
      );

      // 2. 查詢所有用到的 customer_cno
      const cnos = Array.from(new Set(orderData.map((o: any) => o.customer_cno).filter(Boolean)));
      if (cnos.length === 0) return;
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("code, name")
        .in("code", cnos);
      if (customerError || !customerData) return;
      const customerMap: Record<string, string> = {};
      for (const c of customerData) {
        customerMap[c.code] = c.name;
      }
      setCustomers(customerMap);
    };
    fetchOrdersAndCustomers();
  }, []);

  const handleSelect = (orderId: string) => {
    setSelectedOrderId(orderId);
    // TODO: 載入該銷貨單明細
    const order = orders.find(o => o.id === orderId);
    if (order) {
      // 假資料
      const items: SalesOrderItem[] = [
        { id: "i1", productId: "p1", productName: "商品1", originalQty: 10, salePrice: 100 },
        { id: "i2", productId: "p2", productName: "商品2", originalQty: 5, salePrice: 200 },
      ];
      onSelect(order, items);
    }
  };

  return (
    <div className="mb-4">
      <label>選擇銷貨單：</label>
      <select value={selectedOrderId} onChange={e => handleSelect(e.target.value)}>
        <option value="">請選擇</option>
        {orders.map(order => (
          <option key={order.id} value={order.id}>
            {order.orderDate} - {customers[order.customerCno] || order.customerCno || "未知客戶"}
          </option>
        ))}
      </select>
    </div>
  );
}
