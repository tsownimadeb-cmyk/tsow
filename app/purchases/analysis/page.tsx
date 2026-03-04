import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatAmountOneDecimal, formatCurrencyOneDecimal } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

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

interface PurchasesAnalysisPageProps {
  searchParams?: {
    year?: string
  } | Promise<{
    year?: string
  }>
}

export default async function PurchasesAnalysisPage({ searchParams }: PurchasesAnalysisPageProps) {
  noStore()
  const supabase = await createClient()

  const now = new Date()
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedYear = Number.parseInt(String(resolvedSearchParams?.year ?? now.getFullYear()), 10)
  const year = Number.isFinite(selectedYear) ? Math.max(2000, Math.min(2100, selectedYear)) : now.getFullYear()

  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const previousYearStart = `${year - 1}-01-01`
  const previousYearEnd = `${year - 1}-12-31`

  const { data: purchaseRows, error: purchaseError } = await supabase
    .from("purchase_orders")
    .select("id,supplier_id,order_date,total_amount,shipping_fee,status")
    .gte("order_date", yearStart)
    .lte("order_date", yearEnd)

  if (purchaseError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">進貨分析</h1>
          <p className="text-muted-foreground">讀取年度進貨資料失敗</p>
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

  const { data: previousYearPurchaseRows } = await supabase
    .from("purchase_orders")
    .select("id")
    .gte("order_date", previousYearStart)
    .lte("order_date", previousYearEnd)

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
          <p className="text-muted-foreground">依年度檢視進貨總覽、供應商與商品排行</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/purchases">
            <ArrowLeft className="mr-2 h-4 w-4" />
            回進貨管理
          </Link>
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <form className="flex flex-wrap items-center gap-3">
          <Input
            name="year"
            type="number"
            min={2000}
            max={2100}
            defaultValue={String(year)}
            className="w-32"
            aria-label="年份"
          />
          <Button type="submit" variant="outline">套用</Button>
          <Button type="button" variant="ghost" asChild>
            <Link href={`/purchases/analysis?year=${now.getFullYear()}`}>今年</Link>
          </Button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">年度進貨金額</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatCurrencyOneDecimal(totalPurchaseAmount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">年度進貨單數</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatAmountOneDecimal(purchases.length)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">完成率</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatAmountOneDecimal(completionRate)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">年度運費總額</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{formatCurrencyOneDecimal(totalShippingFee)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>供應商進貨排行（依金額）</CardTitle>
        </CardHeader>
        <CardContent>
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
                    <TableCell className="text-right">{formatAmountOneDecimal(row.orderCount)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalAmount)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.averageOrderAmount)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">本年度無進貨資料</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
                  <TableCell colSpan={6} className="text-center text-muted-foreground">本年度無進貨明細</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">趨勢以「本年平均單價」對比「去年平均單價」計算。</p>
        </CardContent>
      </Card>
    </div>
  )
}
