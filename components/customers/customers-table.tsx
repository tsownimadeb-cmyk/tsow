"use client"

import { useState, useEffect, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useDebounce } from "@/hooks/use-debounce"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { Card } from "@/components/ui/card"
import { Search, Phone, User, MapPin, ChevronDown } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { createClient } from "@/lib/supabase/client"
import { CustomerDialog } from "@/components/customers/customer-dialog"

export function CustomersTable({ customers: customersProp }: { customers: any[] }) {
  const router = useRouter();
  const [customers, setCustomers] = useState(customersProp);
  const initialSearch = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('search') || "" : "";
  const [searchText, setSearchText] = useState(initialSearch);
  const debouncedSearch = useDebounce(searchText, 500);
  const [, startTransition] = useTransition();
  const isMobile = useIsMobile();
  const [showHistory, setShowHistory] = useState<{ [code: string]: boolean }>({});
  // 每個客戶的訂單明細資料
  const [orderItemsMap, setOrderItemsMap] = useState<{ [code: string]: any[] }>({});
  const [loadingMap, setLoadingMap] = useState<{ [code: string]: boolean }>({});
  // 導航至新頁時同步新 props
  useEffect(() => { setCustomers(customersProp); }, [customersProp]);
  // 同步搜尋文字至 URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const current = params.get('search') || "";
    if (debouncedSearch === current) return;
    if (debouncedSearch) { params.set('search', debouncedSearch); } else { params.delete('search'); }
    params.set('page', '1');
    startTransition(() => { router.replace(`/customers?${params.toString()}`); });
  }, [debouncedSearch, router]);

  // 全域商品對照
  const [products, setProducts] = useState<{ code: string, name: string, unit: string | null }[]>([]);

  // 初始化時抓取所有商品
  useEffect(() => {
    const fetchProducts = async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("products").select("code, name, unit");
      if (!error && data) setProducts(data as any[]);
    };
    fetchProducts();
  }, []);

  const productMap = useMemo(() => {
    const map = new Map<string, { name: string, unit: string | null }>();
    for (const p of products) map.set(String(p.code).trim(), { name: p.name, unit: p.unit ?? null });
    return map;
  }, [products]);

  // 服務端已進行過濾到 customers props，直接使用
  const filteredCustomers = customers;


  // 查詢客戶所有訂單明細
  const handleToggleHistory = async (code: string) => {
    setShowHistory((prev) => ({ ...prev, [code]: !prev[code] }));
    if (!orderItemsMap[code] && !loadingMap[code]) {
      setLoadingMap((prev) => ({ ...prev, [code]: true }));
      const supabase = createClient();
      // 查詢 sales_orders 取得所有 id
      const { data: orders, error: orderError } = await supabase
        .from("sales_orders")
        .select("id, order_date, total_amount")
        .eq("customer_cno", code)
        .order("order_date", { ascending: false });
      if (orderError || !orders || orders.length === 0) {
        setOrderItemsMap((prev) => ({ ...prev, [code]: [] }));
        setLoadingMap((prev) => ({ ...prev, [code]: false }));
        return;
      }
      const orderIds = orders.map((o: any) => o.id);
      // 查詢所有明細
      let items: any[] = [];
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from("sales_order_items")
          .select("sales_order_id, code, quantity, unit_price")
          .in("sales_order_id", orderIds);
        items = itemsData || [];
      }
      // 合併明細與訂單資訊，並依日期排序（新到舊）
      const itemsWithOrder = items.map((item: any) => {
        const order = orders.find((o: any) => o.id === item.sales_order_id);
        return {
          ...item,
          order_date: order && order.order_date ? order.order_date : null,
          total_amount: order && order.total_amount !== undefined ? order.total_amount : null,
        };
      });
      // 依 order_date 由新到舊排序
      itemsWithOrder.sort((a, b) => {
        if (!a.order_date) return 1;
        if (!b.order_date) return -1;
        return new Date(b.order_date).getTime() - new Date(a.order_date).getTime();
      });
      setOrderItemsMap((prev) => ({ ...prev, [code]: itemsWithOrder }));
      setLoadingMap((prev) => ({ ...prev, [code]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜尋名稱或編號..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-10 pr-8"
        />
        {searchText && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            onClick={() => setSearchText("")}
            aria-label="清除搜尋"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {filteredCustomers.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">查無資料</div>
      ) : (
        <Accordion type="single" collapsible className="w-full">
          {filteredCustomers.map((c: any) => (
            <AccordionItem key={c.code} value={String(c.code)}>
              <Card className="w-full rounded-xl border bg-white shadow-sm transition-all md:max-w-3xl mx-auto">
                <div className="flex items-start justify-between px-6 pt-4">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-blue-600 min-w-[60px]">{c.code}</span>
                    <span className="font-bold text-gray-900 text-base">{c.name}</span>
                  </div>
                  {/* 編輯按鈕入口 */}
                  <div>
                    <CustomerDialog mode="edit" customer={c}>
                      <button
                        type="button"
                        className="rounded-full p-1.5 hover:bg-gray-100 focus:outline-none border border-gray-200"
                        title="編輯客戶"
                        aria-label="編輯客戶"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13h3l8-8a2.828 2.828 0 10-4-4l-8 8v3zm0 0v3h3" />
                        </svg>
                      </button>
                    </CustomerDialog>
                  </div>
                </div>
                <AccordionTrigger className="px-6 py-2 hover:no-underline flex items-center">
                  <div className="flex-1" />
                  <ChevronDown className="ml-2 h-5 w-5 text-gray-400" />
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-gray-500">電話</p>
                      <p className="mt-1 text-base font-semibold text-gray-700">
                        {c.tel1 ? (
                          <a href={`tel:${c.tel1}`} className="underline text-blue-700 hover:text-blue-900">{c.tel1}</a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">聯絡人</p>
                      <p className="mt-1 text-base text-gray-700">{c.contact_person || <span className="text-slate-400">—</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">地址</p>
                      <p className="mt-1 text-base text-gray-700">{c.addr || <span className="text-slate-400">—</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">價格等級</p>
                      <select
                        className="mt-1 w-full rounded border border-gray-300 bg-white py-1 px-2 text-sm text-gray-700"
                        value={c.price_level || "sale"}
                        onChange={async (e) => {
                          const newLevel = e.target.value;
                          const supabase = createClient();
                          const { error } = await supabase
                            .from("customers")
                            .update({ price_level: newLevel })
                            .eq("code", c.code);
                          if (!error) {
                            setCustomers((prev) => prev.map((item) => item.code === c.code ? { ...item, price_level: newLevel } : item));
                          } else {
                            alert("儲存價格等級失敗: " + error.message);
                          }
                        }}
                      >
                        <option value="sale">特價</option>
                        <option value="price">定價</option>
                      </select>
                    </div>
                  </div>
                  {/* 第二層摺疊開關按鈕 */}
                  <div className="mt-4">
                    <button
                      type="button"
                      className="w-full rounded-md border border-gray-200 bg-gray-50 py-2 text-sm font-medium text-blue-700 hover:bg-gray-100 transition"
                      onClick={() => handleToggleHistory(c.code)}
                    >
                      {showHistory[c.code] ? '隱藏完整訂單歷史紀錄' : '查看完整訂單歷史紀錄'}
                    </button>
                  </div>
                  {/* 第二層內容：歷史訂單明細表格（商品名稱、數量、總金額） */}
                  {showHistory[c.code] && (
                    <div className="mt-4 rounded-lg bg-gray-100 p-0 overflow-x-auto">
                      {loadingMap[c.code] ? (
                        <div className="p-6 text-center text-gray-400">載入中...</div>
                      ) : (
                        <table className="min-w-[700px] w-full text-sm table-fixed">
                          <thead>
                            <tr className="bg-gray-200">
                              <th className="px-3 py-2 font-semibold text-gray-700 text-center min-w-[110px]">日期</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 text-left min-w-[180px]">商品名稱</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 text-center min-w-[80px]">數量</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 text-right min-w-[90px]">單價</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 text-right min-w-[100px]">總金額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(orderItemsMap[c.code] && orderItemsMap[c.code].length > 0) ? (
                              orderItemsMap[c.code].map((item: any, idx: number) => {
                                const code = String(item.code ?? '').trim();
                                const product = productMap.get(code);
                                const displayName = product ? product.name : `${code}(待查)`;
                                return (
                                  <tr key={item.sales_order_id + '-' + code + '-' + idx} className="border-b last:border-b-0">
                                    <td className="px-3 py-2 text-center align-middle">{item.order_date ? new Date(item.order_date).toLocaleDateString() : '-'}</td>
                                    <td className="px-3 py-2 text-left align-middle">{displayName}</td>
                                    <td className="px-3 py-2 text-center align-middle">{item.quantity}</td>
                                    <td className="px-3 py-2 text-right align-middle">{typeof item.unit_price === 'number' ? item.unit_price.toLocaleString() : '-'}</td>
                                    <td className="px-3 py-2 text-right align-middle">{typeof item.total_amount === 'number' ? item.total_amount.toLocaleString() : '-'}</td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-gray-400">查無歷史訂單</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </AccordionContent>
              </Card>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
