"use client"

import { ProductDialog } from "./product-dialog"
import { Button } from "@/components/ui/button"

// 定義組件接收的資料型態
interface ProductsTableProps {
  products: any[]
}

// 採用具名導出，確保在 page.tsx 引用時不會出錯
export function ProductsTable({ products }: ProductsTableProps) {
  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">編號</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">商品名稱</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">規格 / 單位</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">定價</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">特價</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-400">
                  目前資料庫沒有商品，請手動新增。
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.pno} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                    {p.pno}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                    {p.pname}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {p.spec} {p.unit}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-blue-600 font-semibold">
                    ${Number(p.price || 0).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold" style={{color: p.sale_price && Number(p.sale_price) > 0 ? '#ef4444' : '#999'}}>
                    {p.sale_price && Number(p.sale_price) > 0 ? `$${Number(p.sale_price).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {/* 這裡調用編輯模式的 ProductDialog */}
                    <ProductDialog mode="edit" product={p}>
                      <Button variant="outline" size="sm">
                        編輯
                      </Button>
                    </ProductDialog>
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