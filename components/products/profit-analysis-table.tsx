"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts"
import type { ProductListRowWithProfit } from "@/lib/products"

interface ProfitAnalysisTableProps {
  products: ProductListRowWithProfit[]
}

const dashboardChartConfig = {
  topTier: {
    label: "前三名",
    color: "var(--chart-2)",
  },
  midTier: {
    label: "中段",
    color: "var(--chart-1)",
  },
  lowTier: {
    label: "後段",
    color: "var(--chart-5)",
  },
  value: {
    label: "實收現金毛利",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

export function ProfitAnalysisTable({ products }: ProfitAnalysisTableProps) {
  const [searchText, setSearchText] = useState("")

  const topProfitProducts = useMemo(
    () =>
      [...products]
        .sort((a, b) => Number(b.cash_gross_profit || 0) - Number(a.cash_gross_profit || 0))
        .slice(0, 10),
    [products],
  )

  const topProfitChartData = useMemo(
    () =>
      topProfitProducts.map((product, index) => ({
        code: String(product.code || "-"),
        name: String(product.name || "-").trim(),
        shortName: String(product.name || "-").trim().slice(0, 8) || String(product.code || "-"),
        rank: index + 1,
        cashGrossProfit: Number(product.cash_gross_profit || 0),
        fill:
          index < 3
            ? "var(--chart-2)"
            : index >= 7 || Number(product.cash_gross_profit || 0) <= 0
              ? "var(--chart-5)"
              : "var(--chart-1)",
      })),
    [topProfitProducts],
  )

  const filteredProducts = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const base = [...products].sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0))
    if (!keyword) return base
                  const keyword = searchText.trim().toLowerCase()
                  const base = [...products].sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0))
                  if (!keyword) return base
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
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {topProfitProducts.map((product, index) => (
            <Card key={`top-profit-${product.code}-${index}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span>TOP {index + 1}</span>
                  <span className="text-xs text-muted-foreground">獲利王</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-sm font-semibold text-foreground truncate">{product.name || "-"}</p>
                <p className="text-xs text-muted-foreground">{product.code || "-"}</p>
                <p className="text-sm font-semibold text-emerald-600">{formatCurrencyOneDecimal(product.cash_gross_profit)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>TOP1~10 實收現金毛利圖</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={dashboardChartConfig} className="h-[260px] w-full">
              <BarChart data={topProfitChartData} margin={{ top: 28, right: 12, left: 8, bottom: 32 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="shortName"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickMargin={12}
                  angle={-45}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      className="bg-white rounded-md border border-border shadow-sm"
                      labelFormatter={(_, payload) => {
                        const item = payload?.[0]?.payload
                        if (!item) return "-"
                        return `TOP${item.rank} ${item.name} (${item.code})`
                      }}
                      formatter={(value) => (
                        <div className="flex min-w-[12rem] items-center justify-between gap-3">
                          <span className="text-muted-foreground">實收現金毛利</span>
                          <span className="text-foreground font-mono font-medium tabular-nums">
                            {formatCurrencyOneDecimal(Number(value || 0))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="cashGrossProfit" fill="var(--chart-1)" radius={[4, 4, 0, 0]}>
                  {topProfitChartData.map((item) => (
                    <Cell key={`bar-${item.code}-${item.rank}`} fill={item.fill} />
                  ))}
                  <LabelList
                    dataKey="cashGrossProfit"
                    position="top"
                    offset={8}
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                    formatter={(value: number) => formatCurrencyOneDecimal(value)}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
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

      <div className="rounded-md border border-gray-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>編號</TableHead>
              <TableHead>商品名稱</TableHead>
              <TableHead className="text-center">狀態</TableHead>
              <TableHead className="text-right">已售數量</TableHead>
              <TableHead className="text-right">單位成本</TableHead>
              <TableHead className="text-right">銷貨收入</TableHead>
              <TableHead className="text-right">銷貨成本(COGS)</TableHead>
              <TableHead className="text-right">帳面毛利</TableHead>
              <TableHead className="text-right">帳面毛利率</TableHead>
              <TableHead className="text-right">實收金額</TableHead>
              <TableHead className="text-right">實收現金毛利</TableHead>
              <TableHead className="text-right">實收毛利率</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-gray-400">
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
                  <TableRow key={product.code}>
                    <TableCell className="font-mono text-sm text-gray-600">{product.code}</TableCell>
                    <TableCell>
                      <div className="font-medium text-gray-900">{product.name}</div>
                      <div className="text-xs text-gray-500">
                        {product.spec || "—"} {product.unit || ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusClassName}`}>
                        {statusLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{Number(product.sales_qty_total || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(unitCost)}</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrencyOneDecimal(Number(product.sales_amount_total || 0))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(Number(product.cogs_total || 0))}</TableCell>
                    <TableCell className="text-right">
                      <span className={grossProfit >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {formatCurrencyOneDecimal(grossProfit)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{`${(grossMargin * 100).toFixed(1)}%`}</TableCell>
                    <TableCell className="text-right text-blue-600">{formatCurrencyOneDecimal(Number(product.cash_received_total || 0))}</TableCell>
                    <TableCell className="text-right">
                      <span className={cashGrossProfit >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                        {formatCurrencyOneDecimal(cashGrossProfit)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{`${(cashGrossMargin * 100).toFixed(1)}%`}</TableCell>
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
