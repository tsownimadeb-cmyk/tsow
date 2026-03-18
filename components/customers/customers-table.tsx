"use client"

import { useState, useMemo, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { Card } from "@/components/ui/card"
import { Search, Phone, User, MapPin, ChevronDown } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { createClient } from "@/lib/supabase/client"

export function CustomersTable({ customers }: { customers: any[] }) {
  const [searchText, setSearchText] = useState("");
  const isMobile = useIsMobile();
  // 新增每個客戶的 showHistory 狀態
  const [showHistory, setShowHistory] = useState<{ [code: string]: boolean }>({});
  // 新增每個客戶的訂單資料
  const [ordersMap, setOrdersMap] = useState<{ [code: string]: any[] }>({});
  const [loadingMap, setLoadingMap] = useState<{ [code: string]: boolean }>({});

  const filteredCustomers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return customers;
    return customers.filter((c: any) => {
      return (
        String(c.code || "").toLowerCase().includes(keyword) ||
        String(c.name || "").toLowerCase().includes(keyword)
      );
    });
  }, [customers, searchText]);


  const handleToggleHistory = async (code: string) => {
    setShowHistory((prev) => ({ ...prev, [code]: !prev[code] }));
    // 若尚未查過，且要展開，才查詢
    if (!ordersMap[code] && !loadingMap[code]) {
      setLoadingMap((prev) => ({ ...prev, [code]: true }));
      const supabase = createClient();
      // 查詢 sales_orders，關聯欄位為 customer_cno
      const { data, error } = await supabase
        .from("sales_orders")
        .select("id, order_no, order_date, total_amount, status")
        .eq("customer_cno", code)
        .order("order_date", { ascending: false });
      setOrdersMap((prev) => ({ ...prev, [code]: error ? [] : data || [] }));
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
          className="pl-10"
        />
      </div>
      {filteredCustomers.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">查無資料</div>
      ) : (
        <Accordion type="single" collapsible className="w-full">
          {filteredCustomers.map((c: any) => (
            <AccordionItem key={c.code} value={String(c.code)}>
              <Card
                className="w-full rounded-xl border bg-white shadow-sm transition-all md:max-w-3xl mx-auto"
              >
                <AccordionTrigger className="px-6 py-4 hover:no-underline flex items-center">
                  <div className="flex flex-1 items-center gap-4">
                    <span className="font-mono text-sm text-blue-600 min-w-[60px]">{c.code}</span>
                    <span className="font-bold text-gray-900 text-base">{c.name}</span>
                  </div>
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
                            c.price_level = newLevel;
                          } else {
                            alert("儲存價格等級失敗: " + error.message);
                          }
                        }}
                      >
                        <option value="sale">特價 (預設)</option>
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
                  {/* 第二層內容：歷史訂單明細表格（商品名稱暫維持橫線） */}
                  {showHistory[c.code] && (
                    <div className="mt-4 rounded-lg bg-gray-100 p-0 overflow-x-auto">
                      {loadingMap[c.code] ? (
                        <div className="p-6 text-center text-gray-400">載入中...</div>
                      ) : (
                        <table className="min-w-[480px] w-full text-sm">
                          <thead>
                            <tr className="bg-gray-200">
                              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">日期</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">單號</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-right">金額</th>
                              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">狀態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(ordersMap[c.code] && ordersMap[c.code].length > 0) ? (
                              ordersMap[c.code].map((order: any) => (
                                <tr key={order.id} className="border-b last:border-b-0">
                                  <td className="px-3 py-2 whitespace-nowrap">{order.order_date ? new Date(order.order_date).toLocaleDateString() : '-'}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">{order.order_no || '-'}</td>
                                  <td className="px-3 py-2 whitespace-nowrap text-right">{typeof order.total_amount === 'number' ? order.total_amount.toLocaleString() : '-'}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">{order.status === 'completed' ? '已完成' : order.status === 'cancelled' ? '已取消' : '處理中'}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-gray-400">查無歷史訂單</td>
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
