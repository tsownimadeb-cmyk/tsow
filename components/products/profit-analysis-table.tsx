"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ProductListRowWithProfit } from "@/lib/products"

interface ProfitAnalysisTableProps {
  products: ProductListRowWithProfit[]
}

export function ProfitAnalysisTable({ products }: ProfitAnalysisTableProps) {
  const [searchText, setSearchText] = useState("")

  const filteredProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const base = [...products].sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0))
    if (!keyword) return base

    return base.filter((product) => {
      const haystacks = [
        String(product.code || ""),
        String(product.name || ""),
        String(product.spec || ""),
        String(product.category || ""),
      ]
      return haystacks.some((value) => value.toLowerCase().includes(keyword))
    })
  }, [products, searchText])

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 bg-white p-4">
        <Input
          placeholder="搜尋商品編號 / 名稱 / 規格 / 種類"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

      <div className="rounded-md border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>編號</TableHead>
              <TableHead>商品名稱</TableHead>
              <TableHead className="text-right">已售數量</TableHead>
              <TableHead className="text-right">銷貨收入</TableHead>
              <TableHead className="text-right">銷貨成本(COGS)</TableHead>
              <TableHead className="text-right">毛利</TableHead>
              <TableHead className="text-right">毛利率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-gray-400">
                  查無符合的商品，請調整搜尋條件。
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const grossProfit = Number(product.gross_profit || 0)
                const grossMargin = Number(product.gross_margin || 0)

                return (
                  <TableRow key={product.code}>
                    <TableCell className="font-mono text-sm text-gray-600">{product.code}</TableCell>
                    <TableCell>
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-500">
                        {product.spec || "—"} {product.unit || ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{Number(product.sales_qty_total || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-blue-600">${Number(product.sales_amount_total || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(product.cogs_total || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <span className={grossProfit >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        ${grossProfit.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{`${(grossMargin * 100).toFixed(1)}%`}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
