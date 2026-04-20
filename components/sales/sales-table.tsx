"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Search, Check, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { useDebounce } from "@/hooks/use-debounce"
import { SalesDialog } from "@/components/sales/sales-dialog"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { SalesOrder, Customer, Product } from "@/lib/types"

interface SalesTableProps {
  sales: SalesOrder[]
  customers: Customer[]
  products: Product[]
  initialSearch?: string
  initialProductSearch?: string
}

const deliveryMethodMap: Record<"self_delivery" | "company_delivery" | "customer_pickup", string> = {
  self_delivery: "本車配送",
  company_delivery: "公司配送",
  customer_pickup: "客戶自取",
}
const STOCK_ADJUSTMENT_NOTE_TAG = "[STOCK_ADJUSTMENT]"

export function SalesTable({
  sales,
  customers,
  products,
  initialSearch = "",
  initialProductSearch = "",
}: SalesTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState(initialSearch)
  const [showProductSearch, setShowProductSearch] = useState(Boolean(initialProductSearch))
  const [productSearch, setProductSearch] = useState(initialProductSearch)
  const debouncedSearch = useDebounce(search, 500)
  const debouncedProductSearch = useDebounce(productSearch, 500)
  const [isPending, startTransition] = useTransition()
  const lastInitialSearchRef = useRef(initialSearch)
  const lastInitialProductSearchRef = useRef(initialProductSearch)

  useEffect(() => {
    const prev = lastInitialSearchRef.current
    lastInitialSearchRef.current = initialSearch

    if (prev === initialSearch) return
    if (search !== debouncedSearch) return
    if (initialSearch === search) return

    setSearch(initialSearch)
  }, [debouncedSearch, initialSearch, search])

  useEffect(() => {
    const prev = lastInitialProductSearchRef.current
    lastInitialProductSearchRef.current = initialProductSearch

    if (prev === initialProductSearch) return
    if (productSearch !== debouncedProductSearch) return
    if (initialProductSearch === productSearch) return

    setProductSearch(initialProductSearch)
    setShowProductSearch(Boolean(initialProductSearch))
  }, [debouncedProductSearch, initialProductSearch, productSearch])
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const currentSearch = params.get("search") || ""
    const currentProductSearch = params.get("productSearch") || ""
    if (debouncedSearch === currentSearch && debouncedProductSearch === currentProductSearch) return

    if (debouncedSearch) {
      params.set("search", debouncedSearch)
    } else {
      params.delete("search")
    }

    if (debouncedProductSearch) {
      params.set("productSearch", debouncedProductSearch)
    } else {
      params.delete("productSearch")
    }

    params.set("page", "1")
    const queryString = params.toString()
    startTransition(() => {
      router.replace(queryString ? `/sales?${queryString}` : "/sales")
    })
  }, [debouncedProductSearch, debouncedSearch, router, startTransition])

  const customerMap = new Map(
    customers.map((customer) => [customer.code, customer] as const),
  )
  // 統一建立商品編號對應商品資訊的 Map
  const productMap = useMemo(() => {
    const map = new Map<string, { name: string, unit: string | null }>()
    for (const p of products) {
      map.set(String(p.code).trim(), { name: p.name, unit: p.unit ?? null })
    }
    return map
  }, [products])

  const getCustomerDisplayName = (sale: SalesOrder) => {
    const customerName = customerMap.get(sale.customer_cno || "")?.name
    if (customerName) return customerName
    if (String(sale.notes || "").includes(STOCK_ADJUSTMENT_NOTE_TAG)) return "校正庫存"
    return "散客"
  }

  // 不再前端 filter，直接顯示 props 傳入的 sales
  const filteredSales = sales

  const handleTogglePaid = (sale: SalesOrder) => {
    const saleId = sale.id
    const currentStatus = Boolean(sale.is_paid)
    const newStatus = !currentStatus
    setUpdatingId(saleId)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const paidAt = newStatus ? new Date().toISOString() : null

        const { error } = await supabase.from("sales_orders").update({ is_paid: newStatus }).eq("id", saleId)

        if (error) {
          toast({ title: "錯誤", description: error.message || "無法更新付款狀態", variant: "destructive" })
          return
        }

        const arPayload = {
          customer_cno: sale.customer_cno,
          amount_due: Number(sale.total_amount),
          total_amount: Number(sale.total_amount),
          paid_amount: newStatus ? Number(sale.total_amount) : 0,
          overpaid_amount: 0,
          paid_at: paidAt,
          due_date: sale.order_date,
          status: newStatus ? "paid" : "unpaid",
        }

        const { data: updatedRows, error: arUpdateError } = await supabase
          .from("accounts_receivable")
          .update(arPayload)
          .eq("sales_order_id", saleId)
          .select("id")
          .limit(1)

        if (arUpdateError) {
          toast({ title: "錯誤", description: arUpdateError.message || "無法更新應收帳款", variant: "destructive" })
          return
        }

        if (!updatedRows || updatedRows.length === 0) {
          const { error: arInsertError } = await supabase
            .from("accounts_receivable")
            .insert({ sales_order_id: saleId, ...arPayload })

          if (arInsertError) {
            const text = `${arInsertError.message || ""} ${arInsertError.details || ""}`.toLowerCase()
            const isDuplicate = arInsertError.code === "23505" || text.includes("duplicate key") || text.includes("unique constraint")

            if (isDuplicate) {
              const { error: retryUpdateError } = await supabase
                .from("accounts_receivable")
                .update(arPayload)
                .eq("sales_order_id", saleId)

              if (retryUpdateError) {
                toast({ title: "錯誤", description: retryUpdateError.message || "無法同步應收帳款", variant: "destructive" })
                return
              }
            } else {
              toast({ title: "錯誤", description: arInsertError.message || "無法建立應收帳款", variant: "destructive" })
              return
            }
          }
        }

        toast({ title: "成功", description: newStatus ? "已標記為已付款" : "已標記為未付款" })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setUpdatingId(null)
      }
    })
  }

  const handleDeleteSale = async (sale: SalesOrder) => {
    if (!window.confirm("確定要刪除此筆單據及其所有明細嗎？")) {
      return
    }

    const saleId = String(sale.id ?? "").trim()
    if (!saleId) {
      toast({ title: "錯誤", description: "找不到主鍵 id，無法刪除", variant: "destructive" })
      return
    }


    try {
      setDeletingSaleId(saleId)
      const supabase = createClient()

      // 取得銷貨明細，若 sales_order_items 為 undefined 則查詢 DB
      let saleItems: Array<{ code: string | null; quantity: number | null }> = Array.isArray(sale.sales_order_items)
        ? sale.sales_order_items.map((item) => ({
            code: item.code ?? null,
            quantity: item.quantity ?? 0,
          }))
        : []

      if (saleItems.length === 0) {
        const { data: items, error: itemsError } = await supabase
          .from("sales_order_items")
          .select("code,quantity")
          .eq("sales_order_id", saleId)
        if (itemsError) {
          console.error('[DEBUG] 查詢銷貨明細失敗:', itemsError)
          throw new Error(itemsError.message || '查詢銷貨明細失敗')
        }
        saleItems = (items || []).map((item) => ({
          code: item.code ?? null,
          quantity: item.quantity ?? 0,
        }))
      }
      console.log('[DEBUG] sales_order_items:', saleItems)

      const quantityByCode = new Map<string, number>()
      for (const item of saleItems) {
        const code = String(item.code || "").trim()
        const quantity = Number(item.quantity ?? 0)
        if (!code || !Number.isFinite(quantity) || quantity <= 0) continue
        quantityByCode.set(code, (quantityByCode.get(code) || 0) + quantity)
      }

      await Promise.all(
        Array.from(quantityByCode.entries()).map(async ([code, quantity]) => {
          // DEBUG: 查詢商品現有庫存
          const { data: product, error: productError } = await supabase
            .from("products")
            .select("code,stock_qty")
            .eq("code", code)
            .single()

          console.log(`[DEBUG] 處理商品: ${code}, 目前庫存:`, product?.stock_qty, '要加回:', quantity)

          if (productError || !product) {
            console.error(`[DEBUG] 查詢商品錯誤:`, productError)
            throw new Error(productError?.message || `找不到商品 ${code}`)
          }

          const coalescedStockQty = Number(product.stock_qty ?? 0)
          const { error: updateInventoryError } = await supabase
            .from("products")
            .update({ stock_qty: coalescedStockQty + quantity })
            .eq("code", code)

          if (updateInventoryError) {
            console.error(`[DEBUG] 更新庫存錯誤:`, updateInventoryError)
            throw new Error(updateInventoryError.message)
          } else {
            console.log(`[DEBUG] 商品 ${code} 庫存已加回，更新後:`, coalescedStockQty + quantity)
          }
        }),
      )

      const { error: detailError } = await supabase.from("sales_order_items").delete().eq("sales_order_id", saleId)
      if (detailError) {
        toast({
          title: "錯誤",
          description: `刪除銷貨明細失敗（sales_order_items.sales_order_id）：${detailError.message}`,
          variant: "destructive",
        })
        return
      }

      const { error: headerError } = await supabase.from("sales_orders").delete().eq("id", saleId)
      if (headerError) {
        toast({
          title: "錯誤",
          description: `刪除銷貨單頭失敗（sales_orders.id）：${headerError.message}`,
          variant: "destructive",
        })
        return
      }

      router.refresh()
    } catch (error) {
      toast({
        title: "錯誤",
        description: error instanceof Error ? `刪除銷貨單失敗：${error.message}` : "刪除銷貨單失敗",
        variant: "destructive",
      })
    } finally {
      setDeletingSaleId(null)
    }
  }

  // 響應式卡片展開狀態
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-4 pb-28">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋單號、客戶名稱..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-8"
            />
            {search && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                onClick={() => setSearch("")}
                aria-label="清除搜尋"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <Button
            type="button"
            variant={showProductSearch ? "default" : "outline"}
            className="sm:w-auto"
            onClick={() => {
              if (showProductSearch) {
                setShowProductSearch(false)
                setProductSearch("")
                return
              }
              setShowProductSearch(true)
            }}
          >
            {showProductSearch ? "關閉商品搜尋" : "商品搜尋"}
          </Button>
        </div>

        {showProductSearch ? (
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋商品名稱或編號..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="pl-10 pr-8"
            />
            {productSearch && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                onClick={() => setProductSearch("")}
                aria-label="清除商品搜尋"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* 桌面版 table（md 以上） */}
      <div className="rounded-lg border hidden md:block">
        {filteredSales.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">{search || productSearch ? "找不到符合條件的銷貨單" : "尚無銷貨單資料"}</div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {filteredSales.map((sale) => {
              const customerName = getCustomerDisplayName(sale)
              const deliveryMethod = sale.delivery_method || "self_delivery"
              const deliveryLabel = deliveryMethodMap[deliveryMethod as keyof typeof deliveryMethodMap] || "本車配送"
              return (
                <AccordionItem key={sale.id} value={sale.id}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                      <div className="col-span-3">
                        <p className="font-medium">{sale.order_no}</p>
                        <p className="text-xs text-muted-foreground">{customerName}</p>
                        <p className="text-xs text-muted-foreground">配送：{deliveryLabel}</p>
                      </div>
                      <div className="col-span-2 text-sm">{new Date(sale.order_date).toLocaleDateString("zh-TW")}</div>
                      <div className="col-span-3 text-right text-sm font-medium">{formatCurrencyOneDecimal(Number(sale.total_amount))}</div>
                      <div className="col-span-4 flex justify-end pr-2">
                        {sale.is_paid ? (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" />已付款
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <X className="h-3 w-3" />未付款
                          </Badge>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    {/* 備註欄位（有內容才顯示） */}
                    {sale.notes && (
                      <div className="mb-2 p-2 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded">
                        <span className="font-bold mr-2">備註：</span>
                        <span className="whitespace-pre-line">{sale.notes}</span>
                      </div>
                    )}
                    <div className="mb-3 flex justify-end">
                      <div className="flex items-center gap-2">
                        <SalesDialog
                          customers={customers}
                          products={products}
                          mode="edit"
                          sales={{ ...sale, sales_order_items: sale.sales_order_items ?? sale.items ?? [] }}
                        >
                          <Button variant="outline" size="sm" className="h-8 px-2">
                            編輯
                          </Button>
                        </SalesDialog>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePaid(sale)}
                          disabled={isPending && updatingId === sale.id}
                          className="h-8 px-2"
                        >
                          {sale.is_paid ? "標記為未付款" : "標記為已付款"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteSale(sale)}
                          disabled={deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim()}
                          className="h-8 px-2"
                        >
                          {deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim() ? "刪除中..." : "刪除"}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>商品名稱</TableHead>
                            <TableHead className="text-right">數量</TableHead>
                            <TableHead className="text-right">單價</TableHead>
                            <TableHead className="text-right">小計</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sale.items && sale.items.length > 0 ? (
                            sale.items.map((item) => {
                              const code = String(item.code ?? '').trim();
                              const product = productMap.get(code);
                              const displayName = product ? product.name : `${code}(待查)`;
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>{displayName}</TableCell>
                                  <TableCell className="text-right">{item.quantity}</TableCell>
                                  <TableCell className="text-right">{formatCurrencyOneDecimal(Number(item.unit_price))}</TableCell>
                                  <TableCell className="text-right">{formatCurrencyOneDecimal(Number(item.subtotal))}</TableCell>
                                </TableRow>
                              )
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                                無商品明細
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </div>

      {/* 手機版卡片（md 以下） */}
      <div className="block md:hidden">
        {filteredSales.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">{search || productSearch ? "找不到符合條件的銷貨單" : "尚無銷貨單資料"}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredSales.map((sale) => {
              const customerName = getCustomerDisplayName(sale)
              const deliveryMethod = sale.delivery_method || "self_delivery"
              const deliveryLabel = deliveryMethodMap[deliveryMethod as keyof typeof deliveryMethodMap] || "本車配送"
              const isExpanded = expandedId === sale.id
              return (
                <div
                  key={sale.id}
                  className={`bg-white rounded-lg border flex flex-col shadow-sm transition-all duration-200 ${isExpanded ? 'ring-2 ring-primary' : ''}`}
                >
                  {/* 可點擊的摘要區 */}
                  <div
                    className="p-4 flex flex-col gap-2 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : sale.id)}
                  >
                    {/* 頂部：單號+付款狀態 */}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-base">{sale.order_no}</span>
                      {sale.is_paid ? (
                        <Badge variant="default" className="gap-1 text-xs px-2 py-0.5">
                          <Check className="h-3 w-3" />已付款
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-xs px-2 py-0.5">
                          <X className="h-3 w-3" />未付款
                        </Badge>
                      )}
                    </div>
                    {/* 中部：客戶名稱與配送方式 */}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{customerName}</span>
                      <span>配送：{deliveryLabel}</span>
                    </div>
                    {/* 底部：日期+總金額 */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{new Date(sale.order_date).toLocaleDateString("zh-TW")}</span>
                      <span className="font-bold text-base text-right">{formatCurrencyOneDecimal(Number(sale.total_amount))}</span>
                    </div>
                  </div>
                  {/* 操作按鈕列 */}
                  <div className="flex items-center gap-2 px-4 pb-3 border-t border-gray-100 pt-2" onClick={(e) => e.stopPropagation()}>
                    <SalesDialog
                      customers={customers}
                      products={products}
                      mode="edit"
                      sales={{ ...sale, sales_order_items: sale.sales_order_items ?? sale.items ?? [] }}
                    >
                      <Button variant="outline" size="sm" className="flex-1 h-8">編輯</Button>
                    </SalesDialog>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePaid(sale)}
                      disabled={isPending && updatingId === sale.id}
                      className="flex-1 h-8 text-xs"
                    >
                      {sale.is_paid ? "標記未付" : "標記已付"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteSale(sale)}
                      disabled={deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim()}
                      className="h-8 px-3"
                    >
                      {deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim() ? "..." : "刪除"}
                    </Button>
                  </div>
                  {/* 摺疊明細 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      {/* 備註欄位（有內容才顯示） */}
                      {sale.notes && (
                        <div className="mt-2 p-2 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded text-xs">
                          <span className="font-bold mr-1">備註：</span>
                          <span className="whitespace-pre-line">{sale.notes}</span>
                        </div>
                      )}
                      <div className="mt-2 space-y-1 bg-gray-50 rounded p-2">
                        {sale.items && sale.items.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {sale.items.map((item) => {
                              const code = String(item.code ?? '').trim();
                              const product = productMap.get(code);
                              const displayName = product ? product.name : `${code}(待查)`;
                              return (
                                <div key={item.id} className="flex items-center justify-between text-sm px-2 py-1">
                                  <span className="flex-1 truncate">{displayName}</span>
                                  <span className="w-10 text-right">{item.quantity}</span>
                                  <span className="w-16 text-right">{formatCurrencyOneDecimal(Number(item.subtotal))}</span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <div className="text-center text-muted-foreground py-2 text-xs">無商品明細</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
