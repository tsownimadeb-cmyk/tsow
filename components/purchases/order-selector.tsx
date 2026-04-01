
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
    setSelectedId(id);
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    const supabase = createClient();
    // 查明細（新舊欄位相容）
    let items: any[] | null = null;
    let usingLegacy = false;
    const { data: itemsByCode, error: errByCode } = await supabase
      .from("purchase_order_items")
      .select("id, code, quantity, unit_price")
      .eq("purchase_order_id", id);
    if (!errByCode && itemsByCode && itemsByCode.length > 0) {
      items = itemsByCode;
    } else {
      const { data: itemsByPno, error: errByPno } = await supabase
        .from("purchase_order_items")
        .select("id, product_pno, quantity, unit_price")
        .eq("purchase_order_id", id);
      if (!errByPno && itemsByPno && itemsByPno.length > 0) {
        items = itemsByPno;
        usingLegacy = true;
      }
    }
    if (!items) {
      onSelect(order, []);
      return;
    }
    // 查商品名稱（新舊欄位相容）
    const codes = Array.from(new Set(items.map(i => String((usingLegacy ? i.product_pno : i.code) || "").trim()).filter(Boolean)));
    let productMap: Record<string, string> = {};
    if (codes.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("code, name")
        .in("code", codes);
      if (products && products.length > 0) {
        productMap = Object.fromEntries(products.map((p: any) => [String(p.code || ""), String(p.name || "")]));
      } else {
        const { data: legacyProducts } = await supabase
          .from("products")
          .select("pno, pname")
          .in("pno", codes);
        if (legacyProducts && legacyProducts.length > 0) {
          productMap = Object.fromEntries(legacyProducts.map((p: any) => [String(p.pno || ""), String(p.pname || "")]));
        }
      }
    }
    const mapped = items.map((i: any) => ({
      id: i.id,
      productId: usingLegacy ? i.product_pno : i.code,
      productName: productMap[String((usingLegacy ? i.product_pno : i.code) || "")] || String((usingLegacy ? i.product_pno : i.code) || ""),
      originalQty: i.quantity,
      purchasePrice: i.unit_price,
    }));
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
