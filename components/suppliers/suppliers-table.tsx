"use client"

import { useState, useMemo, useEffect } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useIsMobile } from "@/hooks/use-mobile"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { SupplierDialog } from "./supplier-dialog"
import { DeleteSupplierDialog } from "./delete-supplier-dialog"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { Supplier, PurchaseOrder, Product } from "@/lib/types"
import { Phone, Search, Pencil, Trash2 } from "lucide-react"



interface SuppliersTableProps {
  suppliers: Supplier[]
}

export function SuppliersTable({ suppliers }: SuppliersTableProps) {
  const [searchText, setSearchText] = useState("")
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null)
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, PurchaseOrder[]>>({})
  const [products, setProducts] = useState<Product[]>([])
  const { toast } = useToast()
  const isMobile = useIsMobile()

  // 取得所有商品，建立 code 對應 name/unit
  useEffect(() => {
    const fetchProducts = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("products")
        .select("code, name, unit")
      if (!error && data) setProducts(data as Product[])
    }
    fetchProducts()
  }, [])

  // 建立商品編號對應商品資訊的 Map
  const productMap = useMemo(() => {
    const map = new Map<string, { name: string, unit: string | null }>()
    for (const p of products) {
      map.set(String(p.code).trim(), { name: p.name, unit: p.unit ?? null })
    }
    return map
  }, [products])

  const filteredSuppliers: Supplier[] = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return [...suppliers]
    return suppliers.filter((s: Supplier) =>
      s.name.toLowerCase().includes(keyword) ||
      (s.contact_person || "").toLowerCase().includes(keyword)
    )
  }, [suppliers, searchText])

  // 分段查詢進貨歷史
  const fetchHistory = async (supplierId: string) => {
    if (!supplierId) return
    setHistoryLoadingId(supplierId)
    try {
      const supabase = createClient()
      // 先查 purchase_orders
      const { data: orders, error } = await supabase
        .from("purchase_orders")
        .select("id, order_no, order_date, total_amount, supplier_id, status, is_paid, notes, created_at, updated_at")
        .eq("supplier_id", supplierId)
        .order("order_date", { ascending: false })
      if (error) throw error
      // 查詢所有明細
      const orderIds = (orders || []).map((o: any) => o.id)
      let itemsByOrder: Record<string, any[]> = {}
      if (orderIds.length > 0) {
        const { data: items } = await supabase
          .from("purchase_order_items")
          .select("id, purchase_order_id, code, quantity, unit_price, subtotal, created_at")
          .in("purchase_order_id", orderIds)
        // 依訂單分組
        for (const item of items || []) {
          if (!itemsByOrder[item.purchase_order_id]) itemsByOrder[item.purchase_order_id] = []
          itemsByOrder[item.purchase_order_id].push(item)
        }
      }
      // 合併明細
      const ordersWithItems = (orders || []).map((order: any) => ({
        ...order,
        items: itemsByOrder[order.id] || []
      }))
      setHistory((prev) => ({ ...prev, [supplierId]: ordersWithItems }))
    } catch (error: any) {
      toast({ title: "查詢失敗", description: error?.message || "無法取得進貨紀錄", variant: "destructive" })
    } finally {
      setHistoryLoadingId(null)
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="px-6 py-4 border-b border-gray-200 bg-white relative max-w-sm">
        <Input
          placeholder="搜尋供應商名稱 / 聯絡人"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pr-8"
        />
        {searchText && (
          <button
            type="button"
            className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            onClick={() => setSearchText("")}
            aria-label="清除搜尋"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {filteredSuppliers.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          {suppliers.length === 0 ? "目前資料庫沒有供應商，請手動新增。" : "查無符合的供應商，請調整搜尋條件。"}
        </div>
      ) : (
        <Accordion type="single" collapsible className="w-full">
          {filteredSuppliers.map((s, idx) => (
            <AccordionItem key={s.id || `supplier-row-${idx}`} value={String(s.id || `supplier-row-${idx}`)}>
              <AccordionTrigger className="px-6 hover:no-underline">
                <div className="flex items-center w-full">
                  <div className="flex-1 text-left text-base font-bold text-gray-900 truncate">{s.name}</div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <div className={isMobile ? "space-y-2" : "grid grid-cols-3 gap-3"}>
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">聯絡人</p>
                    <p className="mt-1 text-base font-semibold text-gray-700">{s.contact_person || "—"}</p>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">聯絡電話</p>
                    <div className="mt-1 space-y-1">
                      <div className="text-base font-semibold text-blue-600">
                        {s.phone ? (
                          <a href={`tel:${s.phone}`} className="hover:underline">{s.phone}</a>
                        ) : "—"}
                      </div>
                      <div className="text-base font-semibold text-blue-600">
                        {s.phone2 ? (
                          <a href={`tel:${s.phone2}`} className="hover:underline">{s.phone2}</a>
                        ) : null}
                      </div>
                      <div className="text-base font-semibold text-blue-600">
                        {s.phone3 ? (
                          <a href={`tel:${s.phone3}`} className="hover:underline">{s.phone3}</a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">地址</p>
                    <p className="mt-1 text-base font-semibold text-gray-700">{s.address || "—"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditSupplier(s)}
                  >
                    編輯
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteSupplier(s)}
                  >
                    刪除
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fetchHistory(s.id)}
                    disabled={historyLoadingId === s.id}
                  >
                    {historyLoadingId === s.id ? "載入中..." : "查看進貨歷史紀錄"}
                  </Button>
                </div>
                {/* 進貨歷史表格 */}
                {history[s.id] && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-[320px] w-full text-sm border">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="px-2 py-1 text-left">日期</th>
                          <th className="px-2 py-1 text-left">商品名稱</th>
                          <th className="px-2 py-1 text-left">數量</th>
                          <th className="px-2 py-1 text-right">總金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history[s.id].length === 0 ? (
                          <tr><td colSpan={4} className="text-center text-gray-400 py-4">無進貨紀錄</td></tr>
                        ) : (
                          history[s.id].flatMap((h) => (
                            h.items && h.items.length > 0
                              ? h.items.map((item: any, idx: number) => (
                                  <tr key={h.id + '-' + item.id}>
                                    {/* 日期只在第一個品項顯示 */}
                                    {idx === 0 ? (
                                      <td className="px-2 py-1 align-top" rowSpan={(h.items?.length) || 1}>{h.order_date}</td>
                                    ) : null}
                                    <td className={isMobile ? "px-2 py-1 break-words max-w-[120px]" : "px-2 py-1"}>
                                      {(() => {
                                        const code = String(item.code ?? '').trim();
                                        const product = productMap.get(code);
                                        if (product) {
                                          return `${product.name}${product.unit ? ` (${product.unit})` : ''}`;
                                        } else if (code) {
                                          return `${code}(待查)`;
                                        } else {
                                          return "(查無明細)";
                                        }
                                      })()}
                                    </td>
                                    <td className={isMobile ? "px-2 py-1 break-words max-w-[80px]" : "px-2 py-1"}>
                                      {item.quantity}
                                      {item.code && productMap.get(item.code)?.unit ? ` (${productMap.get(item.code)?.unit})` : ""}
                                    </td>
                                    {/* 總金額只在第一個品項顯示 */}
                                    {idx === 0 ? (
                                      <td className="px-2 py-1 text-right align-top" rowSpan={(h.items?.length) || 1}>{formatCurrencyOneDecimal(h.total_amount)}</td>
                                    ) : null}
                                  </tr>
                                ))
                              : [
                                  <tr key={h.id + '-empty'}>
                                    <td className="px-2 py-1">{h.order_date}</td>
                                    <td className="px-2 py-1 text-gray-400" colSpan={2}>(查無明細)</td>
                                    <td className="px-2 py-1 text-right">{formatCurrencyOneDecimal(h.total_amount)}</td>
                                  </tr>
                                ]
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
      {/* 編輯/刪除 Dialogs */}
      {editSupplier && (
        <SupplierDialog
          mode="edit"
          supplier={editSupplier}
          open={!!editSupplier}
          onOpenChange={(open) => !open && setEditSupplier(null)}
        />
      )}
      {deleteSupplier && (
        <DeleteSupplierDialog
          supplier={deleteSupplier}
          open={!!deleteSupplier}
          onOpenChange={(open) => !open && setDeleteSupplier(null)}
        />
      )}
    </div>
  )
}
