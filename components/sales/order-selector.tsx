import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type SalesOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerCode: string | null;
  customerName: string | null;
};

export type SalesOrderItem = {
  id: string;
  productId: string;
  productName: string;
  originalQty: number;
  salePrice: number;
};

interface Customer {
  code: string;
  name: string;
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

export default function OrderSelector({ onSelect }: {
  onSelect: (order: SalesOrder, items: SalesOrderItem[]) => void;
}) {
  const defaults = getDefaultDateRange();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerCode, setSelectedCustomerCode] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [itemsLoading, setItemsLoading] = useState(false);

  // 載入所有客戶（依 code 排序）
  useEffect(() => {
    const fetchCustomers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("customers")
        .select("code, name")
        .order("code", { ascending: true });
      if (data) setCustomers(data);
    };
    fetchCustomers();
  }, []);

  // 依客戶 + 日期範圍查詢銷貨單
  useEffect(() => {
    if (!selectedCustomerCode) {
      setOrders([]);
      setSelectedOrderId("");
      return;
    }
    const fetchOrders = async () => {
      setOrdersLoading(true);
      setSelectedOrderId("");
      const supabase = createClient();
      let query = supabase
        .from("sales_orders")
        .select("id, order_no, customer_cno, order_date")
        .eq("customer_cno", selectedCustomerCode)
        .order("order_date", { ascending: false });
      if (dateFrom) query = query.gte("order_date", dateFrom);
      if (dateTo) query = query.lte("order_date", dateTo);
      const { data, error } = await query;
      if (!error && data) {
        setOrders(
          data.map((o: any) => ({
            id: o.id,
            orderNumber: o.order_no || "",
            orderDate: o.order_date,
            customerCode: o.customer_cno,
            customerName: customerSearch,
          }))
        );
      } else {
        setOrders([]);
      }
      setOrdersLoading(false);
    };
    fetchOrders();
  }, [selectedCustomerCode, dateFrom, dateTo]);

  const filteredCustomers = isTyping
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(customerSearch.toLowerCase())
      )
    : customers;

  const handleCustomerSelect = (customer: Customer) => {
    setSelectedCustomerCode(customer.code);
    setCustomerSearch(customer.name);
    setIsTyping(false);
    setShowCustomerList(false);
  };

  const handleOrderChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedOrderId(id);
    const order = orders.find((o) => o.id === id);
    if (!order) return;

    setItemsLoading(true);
    const supabase = createClient();

    const { data: itemsByCode, error: errByCode } = await supabase
      .from("sales_order_items")
      .select("id, code, quantity, unit_price")
      .eq("sales_order_id", id);

    let items: any[] | null = null;
    let usingLegacy = false;

    if (!errByCode && itemsByCode && itemsByCode.length > 0) {
      items = itemsByCode;
    } else {
      const { data: itemsByPno } = await supabase
        .from("sales_order_items")
        .select("id, product_pno, quantity, unit_price")
        .eq("sales_order_id", id);
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

    const mapped: SalesOrderItem[] = items.map((i: any) => ({
      id: i.id,
      productId: usingLegacy ? i.product_pno : i.code,
      productName:
        productMap[String((usingLegacy ? i.product_pno : i.code) || "")] ||
        String((usingLegacy ? i.product_pno : i.code) || ""),
      originalQty: i.quantity,
      salePrice: i.unit_price,
    }));

    onSelect(order, mapped);
    setItemsLoading(false);
  };

  return (
    <div className="mb-4 space-y-3">
      {/* 客戶搜尋 */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">客戶</label>
        <Input
          placeholder="輸入客戶名稱或代碼搜尋..."
          value={customerSearch}
          onChange={(e) => {
            setCustomerSearch(e.target.value);
            setIsTyping(true);
            setShowCustomerList(true);
            if (!e.target.value) {
              setSelectedCustomerCode("");
            }
          }}
          onFocus={(e) => {
            e.target.select();
            setIsTyping(false);
            setShowCustomerList(true);
          }}
          onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
          autoComplete="off"
        />
        {showCustomerList && filteredCustomers.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
            {filteredCustomers.map((c) => (
              <div
                key={c.code}
                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer"
                onMouseDown={() => handleCustomerSelect(c)}
              >
                {c.name}
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

      {/* 銷貨單選擇 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">銷貨單</label>
        {!selectedCustomerCode ? (
          <p className="text-sm text-gray-400">請先選擇客戶</p>
        ) : ordersLoading ? (
          <p className="text-sm text-gray-400">載入銷貨單中...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-gray-400">此期間無銷貨單</p>
        ) : (
          <select
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedOrderId}
            onChange={handleOrderChange}
            disabled={itemsLoading}
          >
            <option value="" disabled>
              {itemsLoading ? "載入明細中..." : "請選擇銷貨單"}
            </option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderDate} — {order.orderNumber}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
