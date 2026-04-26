import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatAmountOneDecimal, formatCurrencyOneDecimal } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// 整數隱藏小數點、加千分位
function formatAmountNoDecimal(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount % 1 === 0
    ? safeAmount.toLocaleString("zh-TW", { maximumFractionDigits: 0 })
    : safeAmount.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatCurrencyNoDecimal(value: number | string | null | undefined) {
  return `$${formatAmountNoDecimal(value)}`
}

type PurchaseOrderRow = {
  id: string
  supplier_id: string | null
  order_date: string
  total_amount: number | null
  shipping_fee: number | null
  status: "pending" | "completed" | "cancelled" | null
}

type PurchaseItemRow = {
  purchase_order_id: string
  code: string | null
  quantity: number | null
  subtotal: number | null
}

type SupplierRow = {
  id: string
  name: string | null
}

type ProductRow = {
  code: string
  name: string | null
}

type SupplierMetric = {
  supplierId: string
  supplierName: string
  orderCount: number
  totalAmount: number
  averageOrderAmount: number
}

type ProductMetric = {
  code: string
  name: string
  purchaseQty: number
  purchaseAmount: number
  averageUnitPrice: number
  previousYearAverageUnitPrice: number | null
  unitPriceTrendRate: number | null
}

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const isDateText = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const shiftDateKeyByYear = (dateKey: string, yearOffset: number) => {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  date.setFullYear(date.getFullYear() + yearOffset)
  return toDateKey(date)
}

interface PurchasesAnalysisPageProps {
  searchParams?: {
    startDate?: string | string[]
    endDate?: string | string[]
  } | Promise<{
    startDate?: string | string[]
    endDate?: string | string[]
  }>
}

export default async function PurchasesAnalysisPage({ searchParams }: PurchasesAnalysisPageProps) {
  noStore()
  const supabase = await createClient()

  const now = new Date()
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const getParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

  const rawStartDate = getParam(resolvedSearchParams?.startDate)
  const rawEndDate = getParam(resolvedSearchParams?.endDate)

  const startDate = isDateText(rawStartDate) ? String(rawStartDate) : ""
  const endDate = isDateText(rawEndDate) ? String(rawEndDate) : ""

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  const previousStartDate = startDate ? shiftDateKeyByYear(startDate, -1) : ""
  const previousEndDate = endDate ? shiftDateKeyByYear(endDate, -1) : ""

  let purchaseQuery = supabase
    .from("purchase_orders")
    .select("id,supplier_id,order_date,total_amount,shipping_fee,status")

  if (startDate) {
    purchaseQuery = purchaseQuery.gte("order_date", startDate)
  }
  if (endDate) {
    purchaseQuery = purchaseQuery.lte("order_date", endDate)
  }

  const { data: purchaseRows, error: purchaseError } = await purchaseQuery

  if (purchaseError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">進貨分析</h1>
          <p className="text-muted-foreground">讀取期間進貨資料失敗</p>
        </div>
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{purchaseError.message}</CardContent>
        </Card>
      </div>
    )
  }

  const purchases = (purchaseRows || []) as PurchaseOrderRow[]
  const purchaseOrderIds = purchases.map((row) => String(row.id || "").trim()).filter(Boolean)
  const supplierIds = Array.from(
    new Set(purchases.map((row) => String(row.supplier_id || "").trim()).filter(Boolean)),
  )

  const [{ data: purchaseItemRows }, { data: supplierRows }] = await Promise.all([
    purchaseOrderIds.length
      ? supabase
          .from("purchase_order_items")
          .select("purchase_order_id,code,quantity,subtotal")
          .in("purchase_order_id", purchaseOrderIds)
      : Promise.resolve({ data: [] as PurchaseItemRow[] }),
    supplierIds.length
      ? supabase.from("suppliers").select("id,name").in("id", supplierIds)
      : Promise.resolve({ data: [] as SupplierRow[] }),
  ])

  const purchaseItems = (purchaseItemRows || []) as PurchaseItemRow[]
  const suppliers = (supplierRows || []) as SupplierRow[]

  const productCodes = Array.from(
    new Set(purchaseItems.map((row) => String(row.code || "").trim()).filter(Boolean)),
  )

  const { data: productRows } = productCodes.length
    ? await supabase.from("products").select("code,name").in("code", productCodes)
    : { data: [] as ProductRow[] }

  let previousYearPurchaseQuery = supabase
    .from("purchase_orders")
    .select("id")

  if (previousStartDate) {
    previousYearPurchaseQuery = previousYearPurchaseQuery.gte("order_date", previousStartDate)
  }
  if (previousEndDate) {
    previousYearPurchaseQuery = previousYearPurchaseQuery.lte("order_date", previousEndDate)
  }

  const { data: previousYearPurchaseRows } = await previousYearPurchaseQuery

  const previousYearOrderIds = (previousYearPurchaseRows || [])
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)

  const { data: previousYearItemRows } = previousYearOrderIds.length
    ? await supabase
        .from("purchase_order_items")
        .select("code,quantity,subtotal")
        .in("purchase_order_id", previousYearOrderIds)
    : { data: [] as Array<Pick<PurchaseItemRow, "code" | "quantity" | "subtotal">> }

  const supplierNameMap = new Map(
    suppliers.map((row) => [String(row.id || "").trim(), String(row.name || row.id || "未知供應商")]),
  )
  const productNameMap = new Map(
    ((productRows || []) as ProductRow[]).map((row) => [String(row.code || "").trim(), String(row.name || row.code || "未知商品")]),
  )

  const supplierMetricsMap = new Map<string, SupplierMetric>()
  for (const purchase of purchases) {
    const supplierId = String(purchase.supplier_id || "").trim()
    if (!supplierId) continue

    const current = supplierMetricsMap.get(supplierId) || {
      supplierId,
      supplierName: supplierNameMap.get(supplierId) || supplierId,
      orderCount: 0,
      totalAmount: 0,
      averageOrderAmount: 0,
    }

    current.orderCount += 1
    current.totalAmount += toSafeNumber(purchase.total_amount)
    current.averageOrderAmount = current.orderCount > 0 ? current.totalAmount / current.orderCount : 0

    supplierMetricsMap.set(supplierId, current)
  }

  const productMetricsMap = new Map<
    string,
    {
      code: string
      name: string
      purchaseQty: number
      purchaseAmount: number
    }
  >()
  for (const item of purchaseItems) {
    const code = String(item.code || "").trim()
    if (!code) continue

    const current = productMetricsMap.get(code) || {
      code,
      name: productNameMap.get(code) || code,
      purchaseQty: 0,
      purchaseAmount: 0,
    }

    current.purchaseQty += toSafeNumber(item.quantity)
    current.purchaseAmount += toSafeNumber(item.subtotal)

    productMetricsMap.set(code, current)
  }

  const previousYearProductTotals = new Map<string, { qty: number; amount: number }>()
  for (const item of previousYearItemRows || []) {
    const code = String(item.code || "").trim()
    if (!code) continue

    const current = previousYearProductTotals.get(code) || { qty: 0, amount: 0 }
    current.qty += toSafeNumber(item.quantity)
    current.amount += toSafeNumber(item.subtotal)
    previousYearProductTotals.set(code, current)
  }

  const supplierMetrics = Array.from(supplierMetricsMap.values()).sort((a, b) => b.totalAmount - a.totalAmount)
  const productMetrics = Array.from(productMetricsMap.values())
    .map((row) => {
      const averageUnitPrice = row.purchaseQty > 0 ? row.purchaseAmount / row.purchaseQty : 0
      const previous = previousYearProductTotals.get(row.code)
      const previousYearAverageUnitPrice =
        previous && previous.qty > 0
          ? previous.amount / previous.qty
          : null
      const unitPriceTrendRate =
        previousYearAverageUnitPrice && previousYearAverageUnitPrice > 0
          ? ((averageUnitPrice - previousYearAverageUnitPrice) / previousYearAverageUnitPrice) * 100
          : null

      const metric: ProductMetric = {
        ...row,
        averageUnitPrice,
        previousYearAverageUnitPrice,
        unitPriceTrendRate,
      }
      return metric
    })
    .sort((a, b) => b.purchaseAmount - a.purchaseAmount)

  const totalPurchaseAmount = purchases.reduce((sum, row) => sum + toSafeNumber(row.total_amount), 0)
  const totalShippingFee = purchases.reduce((sum, row) => sum + toSafeNumber(row.shipping_fee), 0)
  const completedCount = purchases.filter((row) => row.status === "completed").length
  const completionRate = purchases.length > 0 ? (completedCount / purchases.length) * 100 : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">進貨分析</h1>
          <p className="text-muted-foreground">依日期區間檢視進貨總覽、供應商與商品排行</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/purchases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            回進貨管理
          </Link>
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <form className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input type="date" name="startDate" defaultValue={startDate} aria-label="開始日期" />
          <Input type="date" name="endDate" defaultValue={endDate} aria-label="結束日期" />
          <div className="flex gap-2">
            <Button type="submit" variant="outline">套用</Button>
            <Button type="button" variant="ghost" asChild>
              <Link href="/purchases/analysis">清除</Link>
            </Button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/purchases/analysis?startDate=${toDateKey(thisMonthStart)}&endDate=${toDateKey(now)}`}>本月</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/purchases/analysis?startDate=${toDateKey(lastMonthStart)}&endDate=${toDateKey(lastMonthEnd)}`}>上個月</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/purchases/analysis?startDate=${now.getFullYear()}-01-01&endDate=${toDateKey(now)}`}>今年</Link>
          </Button>
        </div>
      </div>

      {/* 統計卡片：手機2欄Grid，縮小padding與標題 */}
      {/* 統計卡片：手機2欄Grid，縮小padding與標題 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-3">
          <CardHeader className="pb-1 px-2">
            <CardTitle className="text-xs font-medium">期間進貨金額</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-1">
            <div className="text-lg sm:text-xl font-bold text-foreground">{formatCurrencyNoDecimal(totalPurchaseAmount)}</div>
          </CardContent>
        </Card>
        <Card className="p-3">
          <CardHeader className="pb-1 px-2">
            <CardTitle className="text-xs font-medium">期間進貨單數</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-1">
            <div className="text-lg sm:text-xl font-bold text-foreground">{formatAmountNoDecimal(purchases.length)}</div>
          </CardContent>
        </Card>
        <Card className="p-3">
          <CardHeader className="pb-1 px-2">
            <CardTitle className="text-xs font-medium">完成率</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-1">
            <div className="text-lg sm:text-xl font-bold text-foreground">{formatAmountNoDecimal(completionRate)}%</div>
          </CardContent>
        </Card>
        <Card className="p-3">
          <CardHeader className="pb-1 px-2">
            <CardTitle className="text-xs font-medium">期間運費總額</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2 pt-1">
            <div className="text-lg sm:text-xl font-bold text-foreground">{formatCurrencyNoDecimal(totalShippingFee)}</div>
          </CardContent>
        </Card>
      </div>

      {/* 供應商排行：手機清單，桌面表格 */}
      <Card>
        <CardHeader>
          <CardTitle>供應商進貨排行（依金額）</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 手機版清單 */}
          <div className="block sm:hidden divide-y">
            {supplierMetrics.length ? (
              supplierMetrics.map((vendor, idx) => (
                <div key={vendor.supplierName || idx} className="flex justify-between items-center py-2">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{vendor.supplierName}</span>
                    <span className="text-xs text-gray-500">單數：{formatAmountNoDecimal(vendor.orderCount)}</span>
                  </div>
                  <span className="text-right font-bold text-emerald-700 min-w-[90px]">{formatCurrencyNoDecimal(vendor.totalAmount)}</span>
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground py-4">此區間無進貨資料</div>
            )}
          </div>
          {/* 桌面版表格 */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>供應商</TableHead>
                  <TableHead className="text-right">進貨單數</TableHead>
                  <TableHead className="text-right">進貨總額</TableHead>
                  <TableHead className="text-right">平均每單</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierMetrics.length ? (
                  supplierMetrics.map((row) => (
                    <TableRow key={row.supplierId}>
                      <TableCell>{row.supplierName}</TableCell>
                      <TableCell className="text-right">{formatAmountNoDecimal(row.orderCount)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyNoDecimal(row.totalAmount)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyNoDecimal(row.averageOrderAmount)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">此區間無進貨資料</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>商品進貨排行（依金額）</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品代碼</TableHead>
                <TableHead>商品名稱</TableHead>
                <TableHead className="text-right">進貨數量</TableHead>
                <TableHead className="text-right">進貨金額</TableHead>
                <TableHead className="text-right">平均單價</TableHead>
                <TableHead className="text-right">平均單價趨勢（較去年）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productMetrics.length ? (
                productMetrics.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right">{formatAmountOneDecimal(row.purchaseQty)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.purchaseAmount)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.averageUnitPrice)}</TableCell>
                    <TableCell className="text-right">
                      {row.unitPriceTrendRate === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.unitPriceTrendRate > 0 ? (
                        <span className="text-destructive">↑ {formatAmountOneDecimal(row.unitPriceTrendRate)}%</span>
                      ) : row.unitPriceTrendRate < 0 ? (
                        <span>↓ {formatAmountOneDecimal(Math.abs(row.unitPriceTrendRate))}%</span>
                      ) : (
                        <span className="text-muted-foreground">0.0%</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">此區間無進貨明細</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">趨勢以「本期平均單價」對比「去年同期平均單價」計算。</p>
        </CardContent>
      </Card>
    </div>
  )
}
