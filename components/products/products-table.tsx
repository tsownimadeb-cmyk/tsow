"use client"

import { useMemo, useState } from "react"
import { ProductDialog } from "./product-dialog"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { ProductListRow } from "@/lib/products"

// 定義組件接收的資料型態
interface ProductsTableProps {
  products: ProductListRow[]
}

// 採用具名導出，確保在 page.tsx 引用時不會出錯
export function ProductsTable({ products }: ProductsTableProps) {
  const { toast } = useToast()
  const [deletingCode, setDeletingCode] = useState<string | null>(null)
  const [searchText, setSearchText] = useState("")

  const filteredProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return products

    return products.filter((product) => {
      const haystacks = [
        String(product.code || ""),
        String(product.name || ""),
        String(product.spec || ""),
        String(product.category || ""),
        String(product.unit || ""),
      ]
      return haystacks.some((value) => value.toLowerCase().includes(keyword))
    })
  }, [products, searchText])

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
      const supabase = createClient()
      const { error } = await supabase.from("products").delete().eq("code", record.code)
      if (error) throw error

      toast({ title: "成功", description: "商品已刪除" })
      window.location.reload()
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
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <Input
          placeholder="搜尋商品編號 / 名稱 / 規格 / 種類"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-12 items-center gap-2 border-b border-gray-200 bg-gray-50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
        <div className="col-span-2">編號</div>
        <div className="col-span-3">商品名稱</div>
        <div className="col-span-3">規格 / 單位</div>
        <div className="col-span-2 text-right">進貨總量</div>
        <div className="col-span-2 text-right">目前庫存</div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          {products.length === 0 ? "目前資料庫沒有商品，請手動新增。" : "查無符合的商品，請調整搜尋條件。"}
        </div>
      ) : (
        <Accordion type="single" collapsible className="w-full">
          {filteredProducts.map((p, index) => (
            <AccordionItem key={p.code || `product-row-${index}`} value={String(p.code || `product-row-${index}`)}>
              <AccordionTrigger className="px-6 hover:no-underline">
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
                    <span className={Number(p.stock_qty || 0) < Number(p.safety_stock || 0) ? "text-red-600" : "text-gray-700"}>
                      {Number(p.stock_qty || 0).toLocaleString()}
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
      )}
    </div>
  )
}