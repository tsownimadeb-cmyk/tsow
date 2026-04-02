// TODO: 實作銷貨單選擇元件，參考進貨單 OrderSelector
// 這裡僅為樣板，需串接實際銷貨單資料
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SalesOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerCode: string | null;
  customerName: string | null;
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

      const ordersList = orderData.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_no || "",
        orderDate: o.order_date,
        customerCode: o.customer_cno,
        customerName: "", // 將在下方填入
      }));
      setOrders(ordersList);

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
      // 更新 orders，填入客戶名稱
      const updatedOrders = ordersList.map((o: any) => ({
        ...o,
        customerName: o.customerCode ? customerMap[o.customerCode] || "" : "",
      }));
      setOrders(updatedOrders);
    };
    fetchOrdersAndCustomers();
  }, []);

  const handleSelect = async (orderId: string) => {
    setSelectedOrderId(orderId);
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    // 查詢該銷貨單的明細
    const supabase = createClient();
    const { data: itemsDataByCode, error: itemsErrorByCode } = await supabase
      .from("sales_order_items")
      .select("id, code, quantity, unit_price")
      .eq("sales_order_id", orderId);

    let itemsData: any[] | null = itemsDataByCode;
    let usingLegacyProductPno = false;

    if (itemsErrorByCode) {
      const { data: itemsDataByPno, error: itemsErrorByPno } = await supabase
        .from("sales_order_items")
        .select("id, product_pno, quantity, unit_price")
        .eq("sales_order_id", orderId);

      if (itemsErrorByPno || !itemsDataByPno) {
        onSelect(order, []);
        return;
      }

      itemsData = itemsDataByPno;
      usingLegacyProductPno = true;
    }

    if (!itemsData) {
      onSelect(order, []);
      return;
    }

    const codes = Array.from(
      new Set(
        itemsData
          .map((item: any) => String((usingLegacyProductPno ? item.product_pno : item.code) || "").trim())
          .filter(Boolean)
      )
    );
    let productNameMap: Record<string, string> = {};
    if (codes.length > 0) {
      const { data: productData } = await supabase
        .from("products")
        .select("code, name")
        .in("code", codes);

      if (productData) {
        productNameMap = Object.fromEntries(productData.map((p: any) => [String(p.code || ""), String(p.name || "")]));
      } else {
        const { data: legacyProductData } = await supabase
          .from("products")
          .select("pno, pname")
          .in("pno", codes);
        if (legacyProductData) {
          productNameMap = Object.fromEntries(legacyProductData.map((p: any) => [String(p.pno || ""), String(p.pname || "")]));
        }
      }
    }

    // 轉換明細格式
    const items: SalesOrderItem[] = itemsData.map((item: any) => ({
      id: item.id,
      productId: usingLegacyProductPno ? item.product_pno : item.code,
      productName:
        productNameMap[String((usingLegacyProductPno ? item.product_pno : item.code) || "")] ||
        String((usingLegacyProductPno ? item.product_pno : item.code) || ""),
      originalQty: item.quantity,
      salePrice: item.unit_price,
    }));
    onSelect(order, items);
  };

  return (
    <div className="mb-4">
      <label>選擇銷貨單：</label>
      <select value={selectedOrderId} onChange={e => handleSelect(e.target.value)}>
        <option value="">請選擇</option>
        {orders.map(order => (
          <option key={order.id} value={order.id}>
            {order.orderDate} - {order.customerName || "未知客戶"}
          </option>
        ))}
      </select>
    </div>
  );
}
