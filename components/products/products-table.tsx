"use client"

import { useState } from "react"
import { ProductDialog } from "./product-dialog"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { ProductListRow } from "@/lib/products"

// 定義組件接收的資料型態
interface ProductsTableProps {
  products: ProductListRow[]
}

// 採用具名導出，確保在 page.tsx 引用時不會出錯
export function ProductsTable({ products }: ProductsTableProps) {
  const { toast } = useToast()
  const [deletingCode, setDeletingCode] = useState<string | null>(null)

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
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">編號</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品名稱</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">規格 / 單位</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">進貨總量</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">目前庫存</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">定價</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">特價</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {products.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-sm text-gray-400">
                  目前資料庫沒有商品，請手動新增。
                </td>
              </tr>
            ) : (
              products.map((p, index) => (
                <tr key={p.code || `product-row-${index}`} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                    {p.code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {p.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {p.spec || "—"} {p.unit || ""}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-700 font-medium">
                    {Number(p.purchase_qty_total || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold">
                    <span className={Number(p.stock_qty || 0) < Number(p.safety_stock || 0) ? "text-red-600" : "text-gray-700"}>
                      {Number(p.stock_qty || 0).toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600 font-semibold">
                    ${Number(p.price || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold" style={{color: p.sale_price && Number(p.sale_price) > 0 ? '#ef4444' : '#999'}}>
                    {p.sale_price && Number(p.sale_price) > 0 ? `$${Number(p.sale_price).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {/* 這裡調用編輯模式的 ProductDialog */}
                      {p.code ? (
                        <ProductDialog
                          mode="edit"
                          product={{
                            code: p.code,
                            name: p.name,
                            spec: p.spec,
                            unit: p.unit,
                            category: p.category,
                            price: p.price,
                            cost: p.cost,
                            sale_price: p.sale_price,
                            stock_qty: p.stock_qty,
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
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}