"use client"

import React, { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ProductListRowWithProfit } from "@/lib/products"
import type { Supplier } from "@/lib/types"

interface ProfitAnalysisTableProps {
  products: ProductListRowWithProfit[]
  suppliers: Supplier[]
}

const formatAmount = (value: number | string | null | undefined) => {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount.toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

const formatCurrency = (value: number | string | null | undefined) => `$${formatAmount(value)}`
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`

const getMarginTheme = (margin: number) => {
  if (margin >= 0.3) {
    return {
      bar: "bg-emerald-500",
      text: "text-emerald-700",
    }
  }

  if (margin < 0.1) {
    return {
      bar: "bg-red-500",
      text: "text-red-700",
    }
  }

  return {
    bar: "bg-amber-500",
    text: "text-amber-700",
  }
}

export function ProfitAnalysisTable({ products, suppliers }: ProfitAnalysisTableProps) {
  const [searchText, setSearchText] = useState("")
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [expandedProductCodes, setExpandedProductCodes] = useState<Set<string>>(new Set())

  const supplierMap = useMemo(() => {
    return new Map(suppliers.map((supplier) => [String(supplier.id), supplier.name]))
  }, [suppliers])

  const filteredProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    let base = [...products].sort((a, b) => Number(b.cash_gross_profit || 0) - Number(a.cash_gross_profit || 0))

    if (selectedSupplierId) {
      base = base.filter((product) => String(product.supplier_id || "") === selectedSupplierId)
    }

    if (!keyword) return base

    return base.filter((product) => {
      const supplierName = product.supplier_id ? supplierMap.get(String(product.supplier_id)) || "" : ""
      const haystacks = [
        String(product.code || ""),
        String(product.name || ""),
        String(product.spec || ""),
        String(product.category || ""),
        supplierName,
      ]
      return haystacks.some((value) => value.toLowerCase().includes(keyword))
    })
  }, [products, searchText, selectedSupplierId, supplierMap])

  const stats = useMemo(() => {
    const soldProducts = filteredProducts.filter((product) => Number(product.sales_qty_total || 0) > 0)
    const totalCashGrossProfit = soldProducts.reduce((sum, product) => sum + Number(product.cash_gross_profit || 0), 0)
    const totalGrossProfit = soldProducts.reduce((sum, product) => sum + Number(product.gross_profit || 0), 0)
    const totalCashReceived = soldProducts.reduce((sum, product) => sum + Number(product.cash_received_total || 0), 0)
    const totalSalesAmount = soldProducts.reduce((sum, product) => sum + Number(product.sales_amount_total || 0), 0)
    const topProduct =
      soldProducts.length > 0
        ? [...soldProducts].sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0))[0]
        : null

    return {
      totalCashGrossProfit,
      totalGrossProfit,
      totalCashReceived,
      totalSalesAmount,
      topProduct,
    }
  }, [filteredProducts])

  const toggleExpand = (productCode: string) => {
    setExpandedProductCodes((current) => {
      const next = new Set(current)
      if (next.has(productCode)) {
        next.delete(productCode)
      } else {
        next.add(productCode)
      }
      return next
    })
  }

  return (
    <div className="space-y-4 max-w-full">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">總實收金額</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-600">{formatCurrency(stats.totalCashReceived)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">總應收金額</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-700">{formatCurrency(stats.totalSalesAmount)}</p>
            <p className="mt-1 text-xs text-gray-500">差額：{formatCurrency(stats.totalSalesAmount - stats.totalCashReceived)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">總實收毛利</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-600">{formatCurrency(stats.totalCashGrossProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">總應收毛利</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${stats.totalGrossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {formatCurrency(stats.totalGrossProfit)}
            </p>
            <p className="mt-1 text-xs text-gray-500">差額：{formatCurrency(stats.totalGrossProfit - stats.totalCashGrossProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">最賺錢商品</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="truncate text-lg font-semibold text-foreground">{stats.topProduct?.name || "-"}</p>
            <p className="text-sm text-muted-foreground">{stats.topProduct?.code || ""}</p>
            <p className="text-xl font-bold text-emerald-600">
              {stats.topProduct ? formatCurrency(stats.topProduct.gross_profit) : "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex items-center gap-2 md:w-64">
            <label htmlFor="supplier-select" className="text-sm text-gray-600 whitespace-nowrap">廠商</label>
            <select
              id="supplier-select"
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedSupplierId}
              onChange={(event) => setSelectedSupplierId(event.target.value)}
            >
              <option value="">全部</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </div>
          <Input
            placeholder="搜尋商品編號 / 名稱 / 規格 / 種類 / 廠商"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-gray-200 bg-white md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>廠商</TableHead>
              <TableHead>商品名稱</TableHead>
              <TableHead className="text-right">已售數量</TableHead>
              <TableHead className="text-right">實收金額</TableHead>
              <TableHead className="text-right">應收金額</TableHead>
              <TableHead className="text-right">實收現金毛利</TableHead>
              <TableHead className="text-right">應收現金毛利</TableHead>
              <TableHead className="text-right">實收毛利率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-gray-400">
                  查無符合的商品，請調整搜尋條件。
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const grossProfit = Number(product.gross_profit || 0)
                const grossMargin = Number(product.gross_margin || 0)
                const cashGrossProfit = Number(product.cash_gross_profit || 0)
                const cashGrossMargin = Number(product.cash_gross_margin || 0)
                const latestPurchasePrice = Number(product.latest_purchase_price || 0)
                const fifoAvgCost = Number(product.sales_qty_total || 0) > 0
                  ? Number(product.cogs_total || 0) / Number(product.sales_qty_total)
                  : latestPurchasePrice
                const isCostRising = latestPurchasePrice > 0 && fifoAvgCost > 0 && latestPurchasePrice > fifoAvgCost * 1.1
                const salesAmount = Number(product.sales_amount_total || 0)
                const cashReceived = Number(product.cash_received_total || 0)
                const cashCollectionRatio = salesAmount > 0 ? cashReceived / salesAmount : 0
                const productCode = String(product.code || "-")
                const isExpanded = expandedProductCodes.has(productCode)
                const marginTheme = getMarginTheme(cashGrossMargin)
                const isGoldenProduct = cashGrossMargin > 0.2
                const isReceivableRisk = grossMargin >= 0.2 && cashCollectionRatio < 0.5
                const isLowOrNegativeMargin = grossMargin <= 0.08 || grossMargin < 0 || cashGrossMargin < 0
                const rowStatusLabel = isGoldenProduct ? "金雞母" : isReceivableRisk ? "欠款風險" : isLowOrNegativeMargin ? "低毛利" : "一般"
                const rowStatusClassName = isGoldenProduct
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : isReceivableRisk
                    ? "bg-amber-100 text-amber-700 border-amber-200"
                    : isLowOrNegativeMargin
                      ? "bg-red-100 text-red-700 border-red-200"
                      : "bg-slate-100 text-slate-700 border-slate-200"
                const supplierName = product.supplier_id ? supplierMap.get(String(product.supplier_id)) || "-" : "-"

                return (
                  <React.Fragment key={productCode}>
                    <TableRow className="align-top">
                      <TableCell className="max-w-32 truncate text-gray-700">{supplierName}</TableCell>
                      <TableCell className="max-w-40 truncate">
                        <button type="button" onClick={() => toggleExpand(productCode)} className="w-full text-left">
                          <div className={`font-medium text-gray-900 ${!isExpanded ? "truncate" : ""}`}>{product.name || "-"}</div>
                          <div className="text-xs text-gray-500">
                            {productCode} ・ {product.spec || "—"} {product.unit || ""}
                          </div>
                          <div className="mt-1">
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${rowStatusClassName}`}>
                              {rowStatusLabel}
                            </span>
                            <span className="ml-2 text-[10px] text-gray-400">
                              {isExpanded ? "點擊收合細節" : "點擊展開細節"}
                            </span>
                          </div>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">{formatAmount(product.sales_qty_total)}</TableCell>
                      <TableCell className="text-right text-blue-600">{formatCurrency(cashReceived)}</TableCell>
                      <TableCell className="text-right text-slate-700">{formatCurrency(salesAmount)}</TableCell>
                      <TableCell className="text-right">
                        <span className={cashGrossProfit >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
                          {formatCurrency(cashGrossProfit)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={grossProfit >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                          {formatCurrency(grossProfit)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className={`font-semibold ${marginTheme.text}`}>{formatPercent(cashGrossMargin)}</span>
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full ${marginTheme.bar}`}
                              style={{ width: `${Math.max(0, Math.min(100, cashGrossMargin * 100))}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow className="bg-slate-50/70">
                        <TableCell colSpan={8}>
                          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">最新進貨單價</p>
                              <div className="mt-1 flex items-center justify-end gap-1.5">
                                {isCostRising && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                      <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" style={{transform: 'rotate(180deg)', transformOrigin: 'center'}} />
                                    </svg>
                                    成本上漲
                                  </span>
                                )}
                                <span className={`font-semibold ${isCostRising ? "text-red-600" : "text-slate-700"}`}>{formatCurrency(latestPurchasePrice)}</span>
                              </div>
                              {isCostRising && (
                                <p className="mt-1 text-right text-[10px] text-slate-400">FIFO 均成本 {formatCurrency(fifoAvgCost)}</p>
                              )}
                            </div>
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">應收金額</p>
                              <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(salesAmount)}</p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">銷貨成本 (COGS)</p>
                              <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(product.cogs_total)}</p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">實收現金毛利</p>
                              <p className={`mt-1 text-right font-semibold ${cashGrossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {formatCurrency(cashGrossProfit)}
                              </p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">應收現金毛利</p>
                              <p className={`mt-1 text-right font-semibold ${grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {formatCurrency(grossProfit)}
                              </p>
                            </div>
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">應收毛利率</p>
                              <p className={`mt-1 text-right font-semibold ${getMarginTheme(grossMargin).text}`}>
                                {formatPercent(grossMargin)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="block space-y-3 md:hidden">
        {filteredProducts.length === 0 ? (
          <div className="rounded-md border bg-white py-8 text-center text-sm text-gray-400">查無符合的商品，請調整搜尋條件。</div>
        ) : (
          filteredProducts.map((product) => {
            const grossProfit = Number(product.gross_profit || 0)
            const grossMargin = Number(product.gross_margin || 0)
            const cashGrossProfit = Number(product.cash_gross_profit || 0)
            const cashGrossMargin = Number(product.cash_gross_margin || 0)
            const latestPurchasePrice = Number(product.latest_purchase_price || 0)
            const fifoAvgCost = Number(product.sales_qty_total || 0) > 0
              ? Number(product.cogs_total || 0) / Number(product.sales_qty_total)
              : latestPurchasePrice
            const isCostRising = latestPurchasePrice > 0 && fifoAvgCost > 0 && latestPurchasePrice > fifoAvgCost * 1.1
            const salesAmount = Number(product.sales_amount_total || 0)
            const cashReceived = Number(product.cash_received_total || 0)
            const cashCollectionRatio = salesAmount > 0 ? cashReceived / salesAmount : 0
            const productCode = String(product.code || "-")
            const isExpanded = expandedProductCodes.has(productCode)
            const marginTheme = getMarginTheme(cashGrossMargin)
            const isGoldenProduct = cashGrossMargin > 0.2
            const isReceivableRisk = grossMargin >= 0.2 && cashCollectionRatio < 0.5
            const isLowOrNegativeMargin = grossMargin <= 0.08 || grossMargin < 0 || cashGrossMargin < 0
            const cardStatusLabel = isGoldenProduct ? "金雞母" : isReceivableRisk ? "欠款風險" : isLowOrNegativeMargin ? "低毛利" : "一般"
            const cardStatusClassName = isGoldenProduct
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : isReceivableRisk
                ? "bg-amber-100 text-amber-700 border-amber-200"
                : isLowOrNegativeMargin
                  ? "bg-red-100 text-red-700 border-red-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"
            const supplierName = product.supplier_id ? supplierMap.get(String(product.supplier_id)) || "-" : "-"

            return (
              <Card key={productCode} className="border border-gray-200 bg-white">
                <CardHeader className="pb-2">
                  <div className="mb-1 text-xs text-gray-500">廠商：{supplierName}</div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold text-gray-900">
                    <span className="max-w-[60vw] truncate">{product.name || "-"}</span>
                    <span className="text-xs text-gray-500">{productCode}</span>
                    <span className={`ml-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cardStatusClassName}`}>
                      {cardStatusLabel}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">已售數量</span>
                    <span className="text-right">{formatAmount(product.sales_qty_total)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">實收金額</span>
                    <span className="text-right text-blue-600">{formatCurrency(cashReceived)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">應收金額</span>
                    <span className="text-right text-slate-700">{formatCurrency(salesAmount)}</span>
                  </div>
                  <div className="mt-2 flex justify-between text-sm">
                    <span className="text-gray-500">實收現金毛利</span>
                    <span className="text-right font-semibold text-emerald-600">{formatCurrency(cashGrossProfit)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">應收現金毛利</span>
                    <span className={`text-right font-semibold ${grossProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatCurrency(grossProfit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">實收毛利率</span>
                    <span className={`font-semibold ${marginTheme.text}`}>{formatPercent(cashGrossMargin)}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full ${marginTheme.bar}`}
                      style={{ width: `${Math.max(0, Math.min(100, cashGrossMargin * 100))}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(productCode)}
                    className="mt-2 w-full text-xs text-gray-500 underline"
                  >
                    {isExpanded ? "點擊收合細節" : "點擊展開細節"}
                  </button>
                  {isExpanded ? (
                    <div className="mt-2 grid grid-cols-1 gap-3 text-sm">
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">最新進貨單價</p>
                        <div className="mt-1 flex items-center justify-end gap-1.5">
                          {isCostRising && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3" style={{transform: 'rotate(180deg)', transformOrigin: 'center'}}>
                                <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
                              </svg>
                              成本上漲
                            </span>
                          )}
                          <span className={`font-semibold ${isCostRising ? "text-red-600" : "text-slate-700"}`}>{formatCurrency(latestPurchasePrice)}</span>
                        </div>
                        {isCostRising && (
                          <p className="mt-1 text-right text-[10px] text-slate-400">FIFO 均成本 {formatCurrency(fifoAvgCost)}</p>
                        )}
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">應收金額</p>
                        <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(salesAmount)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">銷貨成本 (COGS)</p>
                        <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(product.cogs_total)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">實收現金毛利</p>
                        <p className={`mt-1 text-right font-semibold ${cashGrossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {formatCurrency(cashGrossProfit)}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">應收現金毛利</p>
                        <p className={`mt-1 text-right font-semibold ${grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {formatCurrency(grossProfit)}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">應收毛利率</p>
                        <p className={`mt-1 text-right font-semibold ${getMarginTheme(grossMargin).text}`}>
                          {formatPercent(grossMargin)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
