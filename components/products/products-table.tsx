"use client"

import { useState, useEffect, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDebounce } from "@/hooks/use-debounce"
import { useImeInput } from "@/hooks/use-ime-input"
import { ProductDialog } from "./product-dialog"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { ProductListRow } from "@/lib/products"
import { loadMobileCache, loadMobileCacheAsync, MOBILE_CACHE_KEYS } from "@/lib/mobile-cache"

// 定義組件接收的資料型態
interface ProductsTableProps {
  products: ProductListRow[]
  initialSearch?: string
  sortBy?: "code" | "name" | "spec" | "category" | "purchase_qty_total" | "stock_qty" | "price" | "cost"
  sortDir?: "asc" | "desc"
}

type ProductListSortKey = "code" | "name" | "spec" | "category" | "purchase_qty_total" | "stock_qty" | "price" | "cost"
type ProductListSortDir = "asc" | "desc"

// 採用具名導出，確保在 page.tsx 引用時不會出錯
export function ProductsTable({ products, initialSearch = "", sortBy = "code", sortDir = "asc" }: ProductsTableProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [deletingCode, setDeletingCode] = useState<string | null>(null)
  const [searchText, setSearchText] = useState(initialSearch)
  const [isOnline, setIsOnline] = useState(true)
  const [offlineProducts, setOfflineProducts] = useState<ProductListRow[]>([])
  const searchInputProps = useImeInput(searchText, setSearchText)
  const debouncedSearch = useDebounce(searchText, 250)
  const [isPending, startTransition] = useTransition()
  const lastInitialSearchRef = useRef(initialSearch)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkPrices, setBulkPrices] = useState({ base_price: "", price: "", sale_price: "" })

  useEffect(() => {
    const previousInitialSearch = lastInitialSearchRef.current
    lastInitialSearchRef.current = initialSearch

    if (previousInitialSearch === initialSearch) return
    if (searchText !== debouncedSearch) return
    if (initialSearch === searchText) return

    setSearchText(initialSearch)
  }, [debouncedSearch, initialSearch, searchText])

  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true)
    const cached = loadMobileCache<ProductListRow[]>(MOBILE_CACHE_KEYS.productsAll)
    if (cached?.data) {
      setOfflineProducts(cached.data)
    }

    void loadMobileCacheAsync<ProductListRow[]>(MOBILE_CACHE_KEYS.productsAll).then((asyncCached) => {
      if (asyncCached?.data) {
        setOfflineProducts(asyncCached.data)
      }
    })

    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!navigator.onLine) return
    const params = new URLSearchParams(window.location.search)
    const current = params.get('search') || ""
    if (debouncedSearch === current) return
    if (debouncedSearch) { params.set('search', debouncedSearch) } else { params.delete('search') }
    params.set('page', '1')
    startTransition(() => { router.replace(`/products?${params.toString()}`) })
  }, [debouncedSearch, router])

  // 離線時改用本機快取做前端過濾
  const filteredProducts = (() => {
    const base = !isOnline && offlineProducts.length > 0 ? offlineProducts : products
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return base
    return base.filter((p) =>
      [p.code, p.name, p.spec, p.category]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(keyword))
    )
  })()
  const isSearching = searchText !== debouncedSearch || isPending
  const visibleCodes = filteredProducts
    .map((product) => String(product.code || "").trim())
    .filter(Boolean)
  const selectedVisibleCount = visibleCodes.filter((code) => selectedCodes.has(code)).length
  const allVisibleSelected = visibleCodes.length > 0 && selectedVisibleCount === visibleCodes.length

  useEffect(() => {
    const availableCodes = new Set(products.map((product) => String(product.code || "").trim()).filter(Boolean))
    setSelectedCodes((current) => {
      const next = new Set(Array.from(current).filter((code) => availableCodes.has(code)))
      return next.size === current.size ? current : next
    })
  }, [products])

  const setProductSelected = (code: string, selected: boolean) => {
    setSelectedCodes((current) => {
      const next = new Set(current)
      if (selected) next.add(code)
      else next.delete(code)
      return next
    })
  }

  const setAllVisibleSelected = (selected: boolean) => {
    setSelectedCodes((current) => {
      const next = new Set(current)
      for (const code of visibleCodes) {
        if (selected) next.add(code)
        else next.delete(code)
      }
      return next
    })
  }

  const handleBulkPriceUpdate = async () => {
    const prices: Record<string, number> = {}
    for (const [field, rawValue] of Object.entries(bulkPrices)) {
      if (!rawValue.trim()) continue
      const value = Number(rawValue)
      if (!Number.isFinite(value) || value < 0) {
        toast({ title: "錯誤", description: "價格必須是大於或等於 0 的數字", variant: "destructive" })
        return
      }
      prices[field] = value
    }

    if (Object.keys(prices).length === 0) {
      toast({ title: "錯誤", description: "請至少輸入一項要修改的價格", variant: "destructive" })
      return
    }

    try {
      setBulkSaving(true)
      const response = await fetch("/api/offline/products/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: Array.from(selectedCodes), prices }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || `HTTP ${response.status}`)
      }

      toast({
        title: "更新成功",
        description: `已同步更新 ${result.updatedCount || selectedCodes.size} 項商品價格`,
      })
      setBulkDialogOpen(false)
      setBulkPrices({ base_price: "", price: "", sale_price: "" })
      setSelectedCodes(new Set())
      router.refresh()
    } catch (error: any) {
      toast({
        title: "批量更新失敗",
        description: error?.message || "商品價格未變更，請稍後重試",
        variant: "destructive",
      })
    } finally {
      setBulkSaving(false)
    }
  }

  const handleDelete = async (record: ProductListRow) => {
    const isConfirmed = window.confirm("確定要刪除此商品嗎？")
    if (!isConfirmed) return

    const productCode = String(record.code || "").trim()
    if (!productCode) {
      toast({ title: "錯誤", description: "商品缺少 code，無法刪除", variant: "destructive" })
      return
    }

    try {
      setDeletingCode(productCode)
      const response = await fetch(`/api/offline/products?code=${encodeURIComponent(productCode)}`, {
        method: "DELETE",
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.message || `HTTP ${response.status}`)
      }

      toast({
        title: "成功",
        description: result?.offline ? "已離線刪除，待網路恢復後同步" : "商品已刪除",
      })
      router.refresh()
    } catch (error: any) {
      toast({
        title: "錯誤",
        description: error?.message || "刪除商品失敗",
        variant: "destructive",
      })
    } finally {
      setDeletingCode(null)
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="px-3 sm:px-6 py-4 border-b border-gray-200 bg-white relative">
        <Input
          placeholder="搜尋商品編號 / 名稱 / 規格 / 種類"
          {...searchInputProps}
          className="pr-8 w-full sm:max-w-sm"
        />
        {searchText && (
          <button
            type="button"
            className="absolute right-5 sm:right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            onClick={() => setSearchText("")}
            aria-label="清除搜尋"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {isSearching && (
        <div className="px-3 sm:px-6 py-2 text-xs text-gray-500">搜尋中...</div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-blue-50/60 px-3 py-3 sm:px-6">
        <Checkbox
          id="select-visible-products"
          checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? "indeterminate" : false}
          onCheckedChange={(checked) => setAllVisibleSelected(checked === true)}
          disabled={visibleCodes.length === 0}
        />
        <Label htmlFor="select-visible-products" className="cursor-pointer text-sm">
          選取目前清單
        </Label>
        <span className="text-sm text-muted-foreground">已選 {selectedCodes.size} 項</span>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={selectedCodes.size === 0}
          onClick={() => setBulkDialogOpen(true)}
        >
          批量編輯價格
        </Button>
      </div>

      {/* 桌面版標題列 */}
      <div className="hidden md:grid grid-cols-12 items-center gap-2 border-b border-gray-200 bg-gray-50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
        <div className="col-span-2">
          <a href={`?search=${searchText ? encodeURIComponent(searchText) : ""}&sortBy=code&sortDir=${sortBy === "code" && sortDir === "asc" ? "desc" : "asc"}`} className={`hover:text-gray-700 ${sortBy === "code" ? "font-bold text-gray-900" : ""}`}>
            編號 {sortBy === "code" && (sortDir === "asc" ? "↑" : "↓")}
          </a>
        </div>
        <div className="col-span-3">
          <a href={`?search=${searchText ? encodeURIComponent(searchText) : ""}&sortBy=name&sortDir=${sortBy === "name" && sortDir === "asc" ? "desc" : "asc"}`} className={`hover:text-gray-700 ${sortBy === "name" ? "font-bold text-gray-900" : ""}`}>
            商品名稱 {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
          </a>
        </div>
        <div className="col-span-3">
          <a href={`?search=${searchText ? encodeURIComponent(searchText) : ""}&sortBy=spec&sortDir=${sortBy === "spec" && sortDir === "asc" ? "desc" : "asc"}`} className={`hover:text-gray-700 ${sortBy === "spec" ? "font-bold text-gray-900" : ""}`}>
            規格 / 單位 {sortBy === "spec" && (sortDir === "asc" ? "↑" : "↓")}
          </a>
        </div>
        <div className="col-span-2 text-right">
          <a href={`?search=${searchText ? encodeURIComponent(searchText) : ""}&sortBy=purchase_qty_total&sortDir=${sortBy === "purchase_qty_total" && sortDir === "asc" ? "desc" : "asc"}`} className={`hover:text-gray-700 ${sortBy === "purchase_qty_total" ? "font-bold text-gray-900" : ""}`}>
            進貨總量 {sortBy === "purchase_qty_total" && (sortDir === "asc" ? "↑" : "↓")}
          </a>
        </div>
        <div className="col-span-2 text-right">
          <a href={`?search=${searchText ? encodeURIComponent(searchText) : ""}&sortBy=stock_qty&sortDir=${sortBy === "stock_qty" && sortDir === "asc" ? "desc" : "asc"}`} className={`hover:text-gray-700 ${sortBy === "stock_qty" ? "font-bold text-gray-900" : ""}`}>
            目前庫存 {sortBy === "stock_qty" && (sortDir === "asc" ? "↑" : "↓")}
          </a>
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          {isSearching
            ? "搜尋中..."
            : products.length === 0
              ? "目前資料庫沒有商品，請手動新增。"
              : "查無符合的商品，請調整搜尋條件。"}
        </div>
      ) : (
        <>
          {/* 桌面版 Accordion */}
          <Accordion type="single" collapsible className="hidden md:block w-full">
            {filteredProducts.map((p, index) => (
              <AccordionItem key={p.code || `product-row-${index}`} value={String(p.code || `product-row-${index}`)}>
                <AccordionTrigger
                  className="px-3 pr-6 hover:no-underline"
                  leadingContent={p.code ? (
                    <div className="flex items-center pl-6">
                      <Checkbox
                        aria-label={`選取商品 ${p.code}`}
                        checked={selectedCodes.has(p.code)}
                        onCheckedChange={(checked) => setProductSelected(p.code, checked === true)}
                      />
                    </div>
                  ) : null}
                >
                  <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                    <div className="col-span-2 text-sm font-mono text-gray-600">{p.code}</div>
                    <div className="col-span-3 text-sm font-bold text-gray-900">{p.name}</div>
                    <div className="col-span-3 text-sm text-gray-500">
                      {p.spec || "—"} {p.unit || ""}
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-gray-700">
                      {Number(p.purchase_qty_total || 0).toLocaleString()}
                    </div>
                    <div className="col-span-2 text-right text-sm font-semibold">
                      <span className={Number(p.stock_qty) < Number(p.safety_stock || 0) ? "text-red-600" : "text-gray-700"}>
                        {Number(p.stock_qty).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>

                <AccordionContent className="px-6 pb-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">預設進貨單價</p>
                      <p className="mt-1 text-base font-semibold text-gray-700">{formatCurrencyOneDecimal(Number(p.base_price ?? p.purchase_price ?? p.cost ?? 0))}</p>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">定價</p>
                      <p className="mt-1 text-base font-semibold text-blue-600">{formatCurrencyOneDecimal(Number(p.price || 0))}</p>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">特價</p>
                      <p className="mt-1 text-base font-semibold" style={{ color: p.sale_price && Number(p.sale_price) > 0 ? "#ef4444" : "#999" }}>
                        {p.sale_price && Number(p.sale_price) > 0 ? formatCurrencyOneDecimal(Number(p.sale_price)) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    {p.code ? (
                      <ProductDialog
                        mode="edit"
                        product={{
                          code: p.code,
                          name: p.name,
                          spec: p.spec,
                          unit: p.unit,
                          category: p.category,
                          base_price: Number(p.base_price ?? p.purchase_price ?? p.cost ?? 0),
                          price: p.price,
                          cost: p.cost,
                          sale_price: p.sale_price,
                          supplier_id: p.supplier_id || "",
                          stock_qty: p.stock_qty,
                          purchase_qty_total: p.purchase_qty_total,
                          safety_stock: p.safety_stock,
                        }}
                      >
                        <Button variant="outline" size="sm">
                          編輯
                        </Button>
                      </ProductDialog>
                    ) : (
                      <Button variant="outline" size="sm" disabled title="缺少商品 code，無法編輯">
                        編輯
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(p)}
                      disabled={!p.code || deletingCode === p.code}
                    >
                      {deletingCode === p.code ? "刪除中..." : "刪除"}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {/* 手機版卡片列表 */}
          <div className="block md:hidden divide-y divide-gray-100">
            {filteredProducts.map((p, index) => {
              const isLowStock = Number(p.stock_qty) < Number(p.safety_stock || 0)
              return (
                <div key={p.code || `product-mobile-${index}`} className="flex items-stretch">
                  <div className="flex items-center pl-3">
                    {p.code ? (
                      <Checkbox
                        aria-label={`選取商品 ${p.code}`}
                        checked={selectedCodes.has(p.code)}
                        onCheckedChange={(checked) => setProductSelected(p.code, checked === true)}
                      />
                    ) : null}
                  </div>
                  <details className="group min-w-0 flex-1">
                  <summary className="flex items-center justify-between px-3 py-3 cursor-pointer list-none">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-blue-600 shrink-0">{p.code}</span>
                        <span className="text-sm font-bold text-gray-900 truncate">{p.name}</span>
                      </div>
                      {(p.spec || p.unit) && (
                        <div className="text-xs text-gray-500 mt-0.5">{p.spec || ""}{p.unit ? ` · ${p.unit}` : ""}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-2 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-gray-400">庫存</div>
                        <div className={`text-sm font-bold ${isLowStock ? "text-red-600" : "text-gray-700"}`}>
                          {Number(p.stock_qty).toLocaleString()}
                        </div>
                      </div>
                      <svg className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </summary>
                  <div className="px-3 pb-3 bg-gray-50 border-t border-gray-100">
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="rounded border border-gray-200 bg-white p-2 text-center">
                        <p className="text-xs text-gray-500">進貨單價</p>
                        <p className="text-sm font-semibold text-gray-700">{formatCurrencyOneDecimal(Number(p.base_price ?? p.purchase_price ?? p.cost ?? 0))}</p>
                      </div>
                      <div className="rounded border border-gray-200 bg-white p-2 text-center">
                        <p className="text-xs text-gray-500">定價</p>
                        <p className="text-sm font-semibold text-blue-600">{formatCurrencyOneDecimal(Number(p.price || 0))}</p>
                      </div>
                      <div className="rounded border border-gray-200 bg-white p-2 text-center">
                        <p className="text-xs text-gray-500">特價</p>
                        <p className="text-sm font-semibold" style={{ color: p.sale_price && Number(p.sale_price) > 0 ? "#ef4444" : "#999" }}>
                          {p.sale_price && Number(p.sale_price) > 0 ? formatCurrencyOneDecimal(Number(p.sale_price)) : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                      <span>進貨總量：{Number(p.purchase_qty_total || 0).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      {p.code ? (
                        <ProductDialog
                          mode="edit"
                          product={{
                            code: p.code,
                            name: p.name,
                            spec: p.spec,
                            unit: p.unit,
                            category: p.category,
                            base_price: Number(p.base_price ?? p.purchase_price ?? p.cost ?? 0),
                            price: p.price,
                            cost: p.cost,
                            sale_price: p.sale_price,
                            supplier_id: p.supplier_id || "",
                            stock_qty: p.stock_qty,
                            purchase_qty_total: p.purchase_qty_total,
                            safety_stock: p.safety_stock,
                          }}
                        >
                          <Button variant="outline" size="sm">編輯</Button>
                        </ProductDialog>
                      ) : (
                        <Button variant="outline" size="sm" disabled>編輯</Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(p)}
                        disabled={!p.code || deletingCode === p.code}
                      >
                        {deletingCode === p.code ? "刪除中..." : "刪除"}
                      </Button>
                    </div>
                  </div>
                  </details>
                </div>
              )
            })}
          </div>
        </>
      )}

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量編輯商品價格</DialogTitle>
            <DialogDescription>
              將相同價格套用到已選取的 {selectedCodes.size} 項商品。留空的欄位不會變更。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-24 overflow-y-auto rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
            {Array.from(selectedCodes).join("、")}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="bulk-base-price">預設進貨單價</Label>
              <Input
                id="bulk-base-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="保持原值"
                value={bulkPrices.base_price}
                onChange={(event) => setBulkPrices({ ...bulkPrices, base_price: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-list-price">定價</Label>
              <Input
                id="bulk-list-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="保持原值"
                value={bulkPrices.price}
                onChange={(event) => setBulkPrices({ ...bulkPrices, price: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-sale-price">特價</Label>
              <Input
                id="bulk-sale-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="保持原值"
                value={bulkPrices.sale_price}
                onChange={(event) => setBulkPrices({ ...bulkPrices, sale_price: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDialogOpen(false)} disabled={bulkSaving}>
              取消
            </Button>
            <Button type="button" onClick={handleBulkPriceUpdate} disabled={bulkSaving}>
              {bulkSaving ? "更新中..." : `更新 ${selectedCodes.size} 項商品`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
