
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  order_date: string;
  supplier_name?: string;
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

function getDefaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function OrderSelector({ onSelect }: OrderSelectorProps) {
  const defaults = getDefaultDateRange();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [showSupplierList, setShowSupplierList] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [itemsLoading, setItemsLoading] = useState(false);

  // 載入所有供應商
  useEffect(() => {
    const fetchSuppliers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .order("sort_order", { ascending: true, nullsFirst: false });
      if (data) setSuppliers(data);
    };
    fetchSuppliers();
  }, []);

  // 依供應商 + 日期範圍查詢進貨單
  useEffect(() => {
    if (!selectedSupplierId) {
      setOrders([]);
      setSelectedOrderId("");
      return;
    }
    const fetchOrders = async () => {
      setOrdersLoading(true);
      setSelectedOrderId("");
      const supabase = createClient();
      let query = supabase
        .from("purchase_orders")
        .select("id, order_no, supplier_id, order_date, suppliers(name)")
        .eq("supplier_id", selectedSupplierId)
        .order("order_date", { ascending: false });
      if (dateFrom) query = query.gte("order_date", dateFrom);
      if (dateTo) query = query.lte("order_date", dateTo);
      const { data, error } = await query;
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
      } else {
        setOrders([]);
      }
      setOrdersLoading(false);
    };
    fetchOrders();
  }, [selectedSupplierId, dateFrom, dateTo]);

  const filteredSuppliers = isTyping
    ? suppliers.filter((s) => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
    : suppliers;

  const handleSupplierSelect = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setSupplierSearch(supplier.name);
    setIsTyping(false);
    setShowSupplierList(false);
  };

  const handleOrderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedOrderId(id);
    const order = orders.find((o) => o.id === id);
    if (!order) return;

    setItemsLoading(true);
    const supabase = createClient();
    let items: any[] | null = null;
    let usingLegacy = false;

    const { data: itemsByCode, error: errByCode } = await supabase
      .from("purchase_order_items")
      .select("id, code, quantity, unit_price")
      .eq("purchase_order_id", id);
    if (!errByCode && itemsByCode && itemsByCode.length > 0) {
      items = itemsByCode;
    } else {
      const { data: itemsByPno } = await supabase
        .from("purchase_order_items")
        .select("id, product_pno, quantity, unit_price")
        .eq("purchase_order_id", id);
      if (itemsByPno && itemsByPno.length > 0) {
        items = itemsByPno;
        usingLegacy = true;
      }
    }

    if (!items) {
      onSelect(order, []);
      setItemsLoading(false);
      return;
    }

    const codes = Array.from(
      new Set(items.map((i) => String((usingLegacy ? i.product_pno : i.code) || "").trim()).filter(Boolean))
    );
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
          productMap = Object.fromEntries(
            legacyProducts.map((p: any) => [String(p.pno || ""), String(p.pname || "")])
          );
        }
      }
    }

    const mapped = items.map((i: any) => ({
      id: i.id,
      productId: usingLegacy ? i.product_pno : i.code,
      productName:
        productMap[String((usingLegacy ? i.product_pno : i.code) || "")] ||
        String((usingLegacy ? i.product_pno : i.code) || ""),
      originalQty: i.quantity,
      purchasePrice: i.unit_price,
    }));

    onSelect(order, mapped);
    setItemsLoading(false);
  };

  return (
    <div className="mb-4 space-y-3">
      {/* 供應商搜尋 */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">供應商</label>
        <Input
          placeholder="輸入供應商名稱搜尋..."
          value={supplierSearch}
          onChange={(e) => {
            setSupplierSearch(e.target.value);
            setIsTyping(true);
            setShowSupplierList(true);
            if (!e.target.value) {
              setSelectedSupplierId("");
            }
          }}
          onFocus={(e) => {
            e.target.select();
            setIsTyping(false);
            setShowSupplierList(true);
          }}
          onBlur={() => setTimeout(() => setShowSupplierList(false), 150)}
          autoComplete="off"
        />
        {showSupplierList && filteredSuppliers.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
            {filteredSuppliers.map((s) => (
              <div
                key={s.id}
                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                onMouseDown={() => handleSupplierSelect(s)}
              >
                {s.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 日期範圍 */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            const d = getDefaultDateRange();
            setDateFrom(d.from);
            setDateTo(d.to);
          }}
        >
          重設
        </Button>
      </div>

      {/* 進貨單選擇 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">進貨單</label>
        {!selectedSupplierId ? (
          <p className="text-sm text-gray-400">請先選擇供應商</p>
        ) : ordersLoading ? (
          <p className="text-sm text-gray-400">載入進貨單中...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400">此期間無進貨單</p>
        ) : (
          <select
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedOrderId}
            onChange={handleOrderChange}
            disabled={itemsLoading}
          >
            <option value="" disabled>
              {itemsLoading ? "載入明細中..." : "請選擇進貨單"}
            </option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.order_date} — {order.order_no}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
