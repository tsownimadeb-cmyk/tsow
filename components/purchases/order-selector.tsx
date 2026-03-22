
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface PurchaseOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  order_date: string;
  supplier_name?: string;
}

interface PurchaseOrderItem {
  id: string;
  product_pno: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
}

interface OrderSelectorProps {
  onSelect: (order: PurchaseOrder, items: PurchaseOrderItem[]) => void;
}

export default function OrderSelector({ onSelect }: OrderSelectorProps) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      const supabase = createClient();
      // 只查主表
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id,order_no,supplier_id,order_date,suppliers(name)")
        .order("order_date", { ascending: false });
      console.log("purchase_orders", data, error);
      if (!error && data) {
        setOrders(
          data.map((o: any) => ({
            id: o.id,
            order_no: o.order_no,
            supplier_id: o.supplier_id,
            order_date: o.order_date,
            supplier_name: o.suppliers?.name || "",
          }))
        );
      }
      setLoading(false);
    };
    fetchOrders();
  }, []);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    // DEBUG: 印出明細原始資料
    console.log("[DEBUG] purchase_order_items 查詢結果", id);
    setSelectedId(id);
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    const supabase = createClient();
    // 查明細
    const { data: items, error } = await supabase
      .from("purchase_order_items")
      .select("*")
      .eq("purchase_order_id", id);
    console.log("[DEBUG] items", items, error);
    if (error || !items) {
      console.log("明細資料錯誤", items, error);
      onSelect(order, []);
      return;
    }
    // 查商品名稱
    const pnos = items.map((i: any) => i.product_pno).filter(Boolean);
      console.log("[DEBUG] pnos", pnos);
    let productMap: Record<string, string> = {};
    if (pnos.length > 0) {
      const { data: products, error: prodErr } = await supabase
        .from("products")
        .select("pno,pname")
        .in("pno", pnos);
      console.log("[DEBUG] products 查詢結果", products, prodErr);
      if (!prodErr && products) {
        productMap = Object.fromEntries(products.map((p: any) => [p.pno, p.pname]));
        console.log("[DEBUG] productMap", productMap);
      }
    }
    const mapped = items.map((i: any) => ({
      id: i.id,
      productId: i.product_pno,
      productName: productMap[i.product_pno] || "",
      originalQty: i.quantity,
      purchasePrice: i.unit_price,
    }));
    console.log("[DEBUG] mapped", mapped);
    onSelect(order, mapped);
  };

  return (
    <div className="mb-4">
      <select
        className="border rounded px-2 py-1"
        value={selectedId}
        onChange={handleChange}
        disabled={loading}
      >
        <option value="" disabled>
          {loading ? "載入中..." : "請選擇進貨單"}
        </option>
        {orders.map((order) => (
          <option key={order.id} value={order.id}>
            {order.order_date} - {order.supplier_name}
          </option>
        ))}
      </select>
    </div>
  );
}
