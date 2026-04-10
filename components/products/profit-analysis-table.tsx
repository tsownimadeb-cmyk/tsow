"use client"

import React, { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ProductListRowWithProfit } from "@/lib/products"

interface ProfitAnalysisTableProps {
  products: ProductListRowWithProfit[]
}

const formatAmount = (value: number | string | null | undefined) => {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount.toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

const formatCurrency = (value: number | string | null | undefined) => {
  return `$${formatAmount(value)}`
}

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

export function ProfitAnalysisTable({ products }: ProfitAnalysisTableProps) {
  const [searchText, setSearchText] = useState("")
  const [expandedProductCodes, setExpandedProductCodes] = useState<Set<string>>(new Set())

  const filteredProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const base = [...products].sort((a, b) => Number(b.cash_gross_profit || 0) - Number(a.cash_gross_profit || 0))
    if (!keyword) return base

    return base.filter(product => {
      const haystacks = [
        String(product.code || ""),
        String(product.name || ""),
        String(product.spec || ""),
        String(product.category || ""),
      ]
      return haystacks.some((value) => value.toLowerCase().includes(keyword))
    })
  }, [products, searchText])

  const stats = useMemo(() => {
    const soldProducts = filteredProducts.filter((product) => Number(product.sales_qty_total || 0) > 0)
    const totalCashGrossProfit = soldProducts.reduce((sum, product) => sum + Number(product.cash_gross_profit || 0), 0)
    const totalGrossProfit = soldProducts.reduce((sum, product) => sum + Number(product.gross_profit || 0), 0)
    const totalCashReceived = soldProducts.reduce((sum, product) => sum + Number(product.cash_received_total || 0), 0)
    const totalSalesAmount = soldProducts.reduce((sum, product) => sum + Number(product.sales_amount_total || 0), 0)

    const diffAmount = totalCashReceived - totalSalesAmount
    const diffGrossProfit = totalCashGrossProfit - totalGrossProfit

    // 最高應收毛利商品
    const topProduct =
      soldProducts.length > 0
        ? [...soldProducts].sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0))[0]
        : null

    return {
      totalCashGrossProfit,
      totalGrossProfit,
      totalCashReceived,
      totalSalesAmount,
      diffAmount,
      diffGrossProfit,
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
            <p className="text-xs mt-1 text-gray-500">差額：{formatCurrency(stats.totalSalesAmount - stats.totalCashReceived)}</p>
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
            <p className="text-xs mt-1 text-gray-500">差額：{formatCurrency(stats.totalGrossProfit - stats.totalCashGrossProfit)}</p>
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
        <Input
          placeholder="搜尋商品編號 / 名稱 / 規格 / 種類"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

      {/* 桌面版表格 (md 以上) */}
      <div className="hidden md:block rounded-md border border-gray-200 bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
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
                <TableCell colSpan={7} className="py-8 text-center text-sm text-gray-400">
                  查無符合的商品，請調整搜尋條件。
                </TableCell>
              </TableRow>
            ) : (
              filteredProducts.map((product) => {
                const grossProfit = Number(product.gross_profit || 0)
                const grossMargin = Number(product.gross_margin || 0)
                const cashGrossProfit = Number(product.cash_gross_profit || 0)
                const cashGrossMargin = Number(product.cash_gross_margin || 0)
                const unitCost = Number(Number(product.purchase_qty_total || 0) > 0 ? product.cost || 0 : 0)
                const salesAmount = Number(product.sales_amount_total || 0)
                const cashReceived = Number(product.cash_received_total || 0)
                const cashCollectionRatio = salesAmount > 0 ? cashReceived / salesAmount : 0
                const productCode = String(product.code || "-")
                const isExpanded = expandedProductCodes.has(productCode)
                const marginTheme = getMarginTheme(cashGrossMargin)

                const isGoldenProduct = cashGrossMargin > 0.2
                const isReceivableRisk = grossMargin >= 0.2 && cashCollectionRatio < 0.5
                const isLowOrNegativeMargin = grossMargin <= 0.08 || grossMargin < 0 || cashGrossMargin < 0

                const statusLabel = isGoldenProduct
                  ? "金雞母"
                  : isReceivableRisk
                    ? "欠款風險"
                    : isLowOrNegativeMargin
                      ? "低毛利"
                      : "一般"

                const statusClassName = isGoldenProduct
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : isReceivableRisk
                    ? "bg-amber-100 text-amber-700 border-amber-200"
                    : isLowOrNegativeMargin
                      ? "bg-red-100 text-red-700 border-red-200"
                      : "bg-slate-100 text-slate-700 border-slate-200"

                return (
                  <React.Fragment key={productCode}>
                    <TableRow className="align-top">
                      <TableCell className="sm:w-40 sm:max-w-40 sm:truncate">
                        <button
                          type="button"
                          onClick={() => toggleExpand(productCode)}
                          className="w-full text-left"
                        >
                          <div className={`font-medium text-gray-900 ${!isExpanded ? 'truncate' : ''}`}>{product.name || "-"}</div>
                          <div className="text-xs text-gray-500">
                            {productCode} ・ {product.spec || "—"} {product.unit || ""}
                          </div>
                          <div className="mt-1">
                            <span
                              className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusClassName}`}
                            >
                              {statusLabel}
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
                        <span className={cashGrossProfit >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                          {formatCurrency(cashGrossProfit)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={grossProfit >= 0 ? "text-emerald-700 font-semibold" : "text-red-600 font-semibold"}>
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
                      <TableRow key={`${productCode}-details`} className="bg-slate-50/70">
                        <TableCell colSpan={7}>
                          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                            <div className="rounded-md border border-slate-200 bg-white p-3">
                              <p className="text-xs text-slate-500">單位成本</p>
                              <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(unitCost)}</p>
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

      {/* 手機版卡片清單 (md 以下) */}
      <div className="block md:hidden space-y-3">
        {filteredProducts.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 border rounded-md bg-white">查無符合的商品，請調整搜尋條件。</div>
        ) : (
          filteredProducts.map((product) => {
            const grossProfit = Number(product.gross_profit || 0)
            const grossMargin = Number(product.gross_margin || 0)
            const cashGrossProfit = Number(product.cash_gross_profit || 0)
            const cashGrossMargin = Number(product.cash_gross_margin || 0)
            const unitCost = Number(Number(product.purchase_qty_total || 0) > 0 ? product.cost || 0 : 0)
            const salesAmount = Number(product.sales_amount_total || 0)
            const cashReceived = Number(product.cash_received_total || 0)
            const cashCollectionRatio = salesAmount > 0 ? cashReceived / salesAmount : 0
            const productCode = String(product.code || "-")
            const isExpanded = expandedProductCodes.has(productCode)
            const marginTheme = getMarginTheme(cashGrossMargin)

            const isGoldenProduct = cashGrossMargin > 0.2
            const isReceivableRisk = grossMargin >= 0.2 && cashCollectionRatio < 0.5
            const isLowOrNegativeMargin = grossMargin <= 0.08 || grossMargin < 0 || cashGrossMargin < 0

            const statusLabel = isGoldenProduct
              ? "金雞母"
              : isReceivableRisk
                ? "欠款風險"
                : isLowOrNegativeMargin
                  ? "低毛利"
                  : "一般"

            const statusClassName = isGoldenProduct
              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
              : isReceivableRisk
                ? "bg-amber-100 text-amber-700 border-amber-200"
                : isLowOrNegativeMargin
                  ? "bg-red-100 text-red-700 border-red-200"
                  : "bg-slate-100 text-slate-700 border-slate-200"

            return (
              <Card key={productCode} className="border border-gray-200 bg-white">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <span className="truncate max-w-[60vw]">{product.name || "-"}</span>
                    <span className="text-xs text-gray-500">{productCode}</span>
                    <span className={`ml-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${statusClassName}`}>{statusLabel}</span>
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
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-gray-500">實收現金毛利</span>
                    <span className="text-right font-semibold text-emerald-600">{formatCurrency(cashGrossProfit)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">應收現金毛利</span>
                    <span className={`text-right font-semibold ${grossProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatCurrency(grossProfit)}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-500">實收毛利率</span>
                    <span className={`font-semibold ${marginTheme.text}`}>{formatPercent(cashGrossMargin)}</span>
                  </div>
                  <div className="w-full h-2 mt-1 overflow-hidden rounded-full bg-slate-200">
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
                  {isExpanded && (
                    <div className="mt-2 grid grid-cols-1 gap-3 text-sm">
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">單位成本</p>
                        <p className="mt-1 text-right font-semibold text-slate-700">{formatCurrency(unitCost)}</p>
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
                        <p className={`mt-1 text-right font-semibold ${cashGrossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(cashGrossProfit)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">應收現金毛利</p>
                        <p className={`mt-1 text-right font-semibold ${grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(grossProfit)}</p>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <p className="text-xs text-slate-500">應收毛利率</p>
                        <p className={`mt-1 text-right font-semibold ${getMarginTheme(grossMargin).text}`}>{formatPercent(grossMargin)}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
