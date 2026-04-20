import { unstable_noStore as noStore } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatAmountOneDecimal, formatCurrencyOneDecimal, formatAmountNoDecimal } from "@/lib/utils"
import { RankMobileCard } from "./rank-mobile"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { CustomerPreferencePanel } from "@/components/sales/customer-preference-panel"

type SalesOrderRow = {
  id: string
  customer_cno: string | null
  order_date: string
  total_amount: number | null
}

type SalesItemRow = {
  sales_order_id: string
  code: string | null
  quantity: number | null
  subtotal: number | null
  unit_price: number | null
}

type ProductCostRow = {
  code: string
  cost: number | null
  name: string | null
}

type CustomerRow = {
  code: string
  name: string | null
}

type AccountsReceivableRow = {
  sales_order_id: string | null
  customer_cno: string | null
  due_date: string | null
  paid_at: string | null
  status: "unpaid" | "partially_paid" | "paid" | null
}

type CustomerMetric = {
  customerCode: string
  customerName: string
  orderCount: number
  totalSalesAmount: number
  totalGrossProfit: number
  overdueDaysTotal: number
  overdueCount: number
}

const normalizeCustomerCode = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim()
  return normalized || null
}

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseDate = (value: string | null | undefined) => {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

const diffDays = (start: Date, end: Date) => {
  const oneDay = 24 * 60 * 60 * 1000
  return Math.floor((end.getTime() - start.getTime()) / oneDay)
}

interface SalesAnalysisPageProps {
  searchParams?: {
    year?: string
  } | Promise<{
    year?: string
  }>
}

export default async function SalesAnalysisPage({ searchParams }: SalesAnalysisPageProps) {
  noStore()
  const supabase = await createClient()

  const now = new Date()
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedYear = Number.parseInt(String(resolvedSearchParams?.year ?? now.getFullYear()), 10)
  const year = Number.isFinite(selectedYear) ? Math.max(2000, Math.min(2100, selectedYear)) : now.getFullYear()

  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const { data: salesRows, error: salesError } = await supabase
    .from("sales_orders")
    .select("id,customer_cno,order_date,total_amount")
    .gte("order_date", yearStart)
    .lte("order_date", yearEnd)

  if (salesError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">銷貨分析</h1>
          <p className="text-muted-foreground">讀取年度銷貨資料失敗</p>
        </div>
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{salesError.message}</CardContent>
        </Card>
      </div>
    )
  }

  const sales = (salesRows || []) as SalesOrderRow[]
  const salesOrderIds = sales.map((row) => row.id).filter(Boolean)

  const IN_CHUNK_SIZE = 50

  async function fetchInChunks<T>(
    table: string,
    selectFields: string,
    column: string,
    ids: string[],
  ): Promise<T[]> {
    if (ids.length === 0) return []
    const rows: T[] = []
    for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + IN_CHUNK_SIZE)
      const { data } = await supabase.from(table).select(selectFields).in(column, chunk)
      if (data) rows.push(...(data as T[]))
    }
    return rows
  }

  const [customerRows, salesItemRows, arRows] = await Promise.all([
    supabase.from("customers").select("code,name").then((r) => r.data || []),
    fetchInChunks<SalesItemRow>("sales_order_items", "sales_order_id,code,quantity,subtotal,unit_price", "sales_order_id", salesOrderIds),
    fetchInChunks<AccountsReceivableRow>("accounts_receivable", "sales_order_id,customer_cno,due_date,paid_at,status", "sales_order_id", salesOrderIds),
  ])

  const salesItems = salesItemRows as SalesItemRow[]
  const arRecords = arRows as AccountsReceivableRow[]
  const customers = customerRows as CustomerRow[]

  const productCodes = Array.from(
    new Set(salesItems.map((row) => String(row.code ?? "").trim()).filter(Boolean)),
  )

  const productRows = await fetchInChunks<ProductCostRow>("products", "code,cost,name", "code", productCodes)

  const productCostMap = new Map(
    productRows.map((row) => [String(row.code || "").trim(), toSafeNumber(row.cost)]),
  )
  const productNameMap = new Map(
    productRows.map((row) => [String(row.code || "").trim(), String(row.name || row.code || "未知商品")]),
  )
  const customerNameMap = new Map(
    customers.map((row) => [String(row.code || "").trim(), String(row.name || row.code || "未知客戶")]),
  )
  const orderDateMap = new Map(sales.map((row) => [String(row.id || "").trim(), String(row.order_date || "")]))

  const orderGrossProfitMap = new Map<string, number>()
  for (const item of salesItems) {
    const salesOrderId = String(item.sales_order_id || "").trim()
    if (!salesOrderId) continue

    const code = String(item.code || "").trim()
    const quantity = toSafeNumber(item.quantity)
    const subtotal = toSafeNumber(item.subtotal)
    const cost = toSafeNumber(productCostMap.get(code))
    const grossProfit = subtotal - quantity * cost

    orderGrossProfitMap.set(salesOrderId, toSafeNumber(orderGrossProfitMap.get(salesOrderId)) + grossProfit)
  }

  const metricByCustomer = new Map<string, CustomerMetric>()
  const salesOrderCustomerMap = new Map<string, string>()

  for (const order of sales) {
    const customerCode = normalizeCustomerCode(order.customer_cno)
    if (!customerCode) continue

    salesOrderCustomerMap.set(String(order.id || "").trim(), customerCode)

    const current = metricByCustomer.get(customerCode) || {
      customerCode,
      customerName: customerNameMap.get(customerCode) || customerCode,
      orderCount: 0,
      totalSalesAmount: 0,
      totalGrossProfit: 0,
      overdueDaysTotal: 0,
      overdueCount: 0,
    }

    current.orderCount += 1
    current.totalSalesAmount += toSafeNumber(order.total_amount)
    current.totalGrossProfit += toSafeNumber(orderGrossProfitMap.get(order.id))

    metricByCustomer.set(customerCode, current)
  }

  const today = new Date()
  for (const ar of arRecords) {
    const salesOrderId = String(ar.sales_order_id || "").trim()
    const fallbackCustomerCode = salesOrderCustomerMap.get(salesOrderId)
    const customerCode = normalizeCustomerCode(ar.customer_cno || fallbackCustomerCode)
    if (!customerCode) continue

    const metric = metricByCustomer.get(customerCode)
    if (!metric) continue

    const dueDate = parseDate(ar.due_date)
    if (!dueDate) continue

    const paidAt = parseDate(ar.paid_at)
    const referenceDate = paidAt || today
    const overdueDays = Math.max(0, diffDays(dueDate, referenceDate))

    if (overdueDays > 0) {
      metric.overdueDaysTotal += overdueDays
      metric.overdueCount += 1
    }
  }

  const metrics = Array.from(metricByCustomer.values())
  const totalYearGrossProfit = metrics.reduce((sum, row) => sum + toSafeNumber(row.totalGrossProfit), 0)

  const customerProductStats = new Map<
    string,
    Map<
      string,
      {
        code: string
        name: string
        purchaseQty: number
        purchaseCount: number
        lastUnitPrice: number
        lastOrderDate: string
      }
    >
  >()

  for (const item of salesItems) {
    const salesOrderId = String(item.sales_order_id || "").trim()
    const customerCode = salesOrderCustomerMap.get(salesOrderId)
    const productCode = String(item.code || "").trim()
    if (!customerCode || !productCode) continue

    const productStatsMap = customerProductStats.get(customerCode) || new Map()
    const current = productStatsMap.get(productCode) || {
      code: productCode,
      name: productNameMap.get(productCode) || productCode,
      purchaseQty: 0,
      purchaseCount: 0,
      lastUnitPrice: 0,
      lastOrderDate: "",
    }

    current.purchaseQty += toSafeNumber(item.quantity)
    current.purchaseCount += 1

    const orderDate = String(orderDateMap.get(salesOrderId) || "")
    if (!current.lastOrderDate || orderDate >= current.lastOrderDate) {
      current.lastOrderDate = orderDate
      current.lastUnitPrice = toSafeNumber(item.unit_price)
    }

    productStatsMap.set(productCode, current)
    customerProductStats.set(customerCode, productStatsMap)
  }

  const customerPreferenceItems = [...metrics]
    .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount)
    .slice(0, 12)
    .map((metric) => {
      const productMap = customerProductStats.get(metric.customerCode) || new Map()
      const products = [...productMap.values()]
        .sort((a, b) => b.purchaseQty - a.purchaseQty || b.purchaseCount - a.purchaseCount)
        .slice(0, 10)

      return {
        customerCode: metric.customerCode,
        customerName: metric.customerName,
        products,
      }
    })

  const cumulativeContributionRanks = [...metrics]
    .sort((a, b) => b.totalGrossProfit - a.totalGrossProfit)
    .slice(0, 10)
    .map((row) => ({
      ...row,
      contributionRatio: totalYearGrossProfit > 0 ? row.totalGrossProfit / totalYearGrossProfit : 0,
    }))
  const maxContributionRatio = cumulativeContributionRanks[0]?.contributionRatio || 0

  const avgGrossContributionRanks = [...metrics]
    .filter((row) => row.orderCount > 0)
    .sort((a, b) => b.totalGrossProfit / b.orderCount - a.totalGrossProfit / a.orderCount)
    .slice(0, 10)

  const repurchaseFrequencyRanks = [...metrics]
    .sort((a, b) => b.orderCount - a.orderCount || b.totalSalesAmount - a.totalSalesAmount)
    .slice(0, 10)

  const overdueDaysRanks = [...metrics]
    .filter((row) => row.overdueCount > 0)
    .sort((a, b) => b.overdueDaysTotal / b.overdueCount - a.overdueDaysTotal / a.overdueCount)
    .slice(0, 10)

  const yearOptions = [year - 2, year - 1, year]

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">銷貨分析</h1>
          <p className="text-muted-foreground">{year} 年客戶排行：累積貢獻、平均毛利、回購頻率、欠款天數</p>
        </div>
        <form className="flex items-center gap-2" action="/sales/analysis" method="get">
          <Input className="w-28" name="year" type="number" min={2000} max={2100} defaultValue={year} />
          <Button type="submit" variant="outline">切換年度</Button>
        </form>
      </div>

      {/* 年度切換區：手機水平滾動 */}
      <div className="flex gap-2 overflow-x-auto pb-2 md:overflow-visible md:pb-0">
        {yearOptions.map((candidateYear) => (
          <Button key={candidateYear} variant={candidateYear === year ? "default" : "outline"} size="sm" asChild className="min-w-[90px]">
            <Link href={`/sales/analysis?year=${candidateYear}`}>{candidateYear} 年</Link>
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 桌面版表格 */}
        <div className="hidden md:block">
          <Card>
            <CardHeader>
              <CardTitle>累積貢獻排行（誰是你的年度冠軍？）</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">排名</TableHead>
                    <TableHead>客戶</TableHead>
                    <TableHead className="text-right">年度累積毛利</TableHead>
                    <TableHead className="text-right">貢獻占比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cumulativeContributionRanks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">本年度尚無銷貨資料</TableCell>
                    </TableRow>
                  ) : (
                    cumulativeContributionRanks.map((row, index) => (
                      <TableRow key={`cumulative-${row.customerCode}`}>
                        <TableCell>#{index + 1}</TableCell>
                        <TableCell>{row.customerName}</TableCell>
                        <TableCell className="text-right">${formatAmountNoDecimal(row.totalGrossProfit)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-3">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary/40"
                                style={{
                                  width: `${maxContributionRatio > 0 ? (row.contributionRatio / maxContributionRatio) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className="w-14 text-right tabular-nums">{formatAmountOneDecimal(row.contributionRatio * 100)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        {/* 手機版排行卡片 */}
        <div className="block md:hidden space-y-3">
          <div className="font-semibold text-lg mb-1">累積貢獻排行</div>
          {cumulativeContributionRanks.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">本年度尚無銷貨資料</div>
          ) : (
            cumulativeContributionRanks.map((row, index) => {
              let highlight: "gold" | "silver" | "bronze" | undefined
              if (index === 0) highlight = "gold"
              else if (index === 1) highlight = "silver"
              else if (index === 2) highlight = "bronze"
              let subInfo = `貢獻占比 ${formatAmountOneDecimal(row.contributionRatio * 100)}%`
              return (
                <RankMobileCard
                  key={`cumulative-m-${row.customerCode}`}
                  rank={index + 1}
                  name={row.customerName}
                  value={`$${formatAmountNoDecimal(row.totalGrossProfit)}`}
                  subInfo={subInfo}
                  highlight={highlight}
                />
              )
            })
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>平均毛利貢獻（誰買的東西最讓你賺錢？）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">排名</TableHead>
                  <TableHead>客戶</TableHead>
                  <TableHead className="text-right">平均每單毛利</TableHead>
                  <TableHead className="text-right">訂單數</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {avgGrossContributionRanks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">本年度尚無可分析資料</TableCell>
                  </TableRow>
                ) : (
                  avgGrossContributionRanks.map((row, index) => (
                    <TableRow key={`avg-gross-${row.customerCode}`}>
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell>{row.customerName}</TableCell>
                      <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalGrossProfit / row.orderCount)}</TableCell>
                      <TableCell className="text-right">{row.orderCount.toLocaleString("zh-TW")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>回購頻率（誰最常來？）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">排名</TableHead>
                  <TableHead>客戶</TableHead>
                  <TableHead className="text-right">年度訂單數</TableHead>
                  <TableHead className="text-right">年度銷貨金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repurchaseFrequencyRanks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">本年度尚無銷貨資料</TableCell>
                  </TableRow>
                ) : (
                  repurchaseFrequencyRanks.map((row, index) => (
                    <TableRow key={`repurchase-${row.customerCode}`}>
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell>{row.customerName}</TableCell>
                      <TableCell className="text-right">{row.orderCount.toLocaleString("zh-TW")}</TableCell>
                      <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalSalesAmount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>欠款天數排行（誰最常拖欠？）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">排名</TableHead>
                  <TableHead>客戶</TableHead>
                  <TableHead className="text-right">平均逾期天數</TableHead>
                  <TableHead className="text-right">逾期筆數</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueDaysRanks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">本年度尚無逾期紀錄</TableCell>
                  </TableRow>
                ) : (
                  overdueDaysRanks.map((row, index) => (
                    <TableRow key={`overdue-${row.customerCode}`}>
                      <TableCell>#{index + 1}</TableCell>
                      <TableCell>{row.customerName}</TableCell>
                      <TableCell className="text-right">{formatAmountOneDecimal(row.overdueDaysTotal / row.overdueCount)} 天</TableCell>
                      <TableCell className="text-right">{row.overdueCount.toLocaleString("zh-TW")}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>客戶偏好（點擊客戶查看熱銷組合與最近單價）</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerPreferencePanel items={customerPreferenceItems} />
        </CardContent>
      </Card>
    </div>
  )
}
