import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import {
  fetchProductProfitAnalysisByCode,
  fetchProductsRows,
  normalizeProducts,
  type ProductListRowWithProfit,
} from "@/lib/products"
import { Button } from "@/components/ui/button"
import { ProfitAnalysisTable } from "@/components/products/profit-analysis-table"
import { Input } from "@/components/ui/input"

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()
const normalizeText = (value: unknown) => String(value ?? "").trim()
const EXCLUDED_PRODUCT_KEYWORDS = ["前年帳款"]
const isDateText = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))

const toDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

interface ProductProfitAnalysisPageProps {
  searchParams?: {
    startDate?: string
    endDate?: string
  } | Promise<{
    startDate?: string
    endDate?: string
  }>
}

export default async function ProductProfitAnalysisPage({ searchParams }: ProductProfitAnalysisPageProps) {
  noStore()
  const supabase = await createClient()

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const getParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  const rawStartDate = getParam(resolvedSearchParams?.startDate)
  const rawEndDate = getParam(resolvedSearchParams?.endDate)

  const startDate = isDateText(rawStartDate) ? String(rawStartDate) : ""
  const endDate = isDateText(rawEndDate) ? String(rawEndDate) : ""

  const { rows: productsRaw, warning: productsWarning } = await fetchProductsRows(supabase)
  if (productsWarning) {
    console.error("[ProductProfitAnalysisPage] products 查詢失敗:", productsWarning)
  }

  const products = normalizeProducts(productsRaw || [])
  const filteredProducts = products.filter((product) => {
    const code = normalizeText(product.code)
    const name = normalizeText(product.name)
    return !EXCLUDED_PRODUCT_KEYWORDS.some((keyword) => code === keyword || name === keyword)
  })

  const productCodes = filteredProducts.map((product) => String(product.code || ""))
  const { summaryByCode, warning: profitWarning } = await fetchProductProfitAnalysisByCode(supabase, productCodes, {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  })

  if (profitWarning) {
    console.error("[ProductProfitAnalysisPage] 商品損益彙總查詢失敗:", profitWarning)
  }

  const productsWithProfit: ProductListRowWithProfit[] = filteredProducts.map((product) => {
    const key = normalizeCode(product.code)
    const summary = summaryByCode.get(key)
    const salesQtyTotal = toNumber(summary?.sales_qty_total)
    const salesAmountTotal = toNumber(summary?.sales_amount_total)
    const cashReceivedTotal = toNumber(summary?.cash_received_total)
    const unitCost = toNumber(product.cost)
    const cogsTotal = salesQtyTotal * unitCost
    const grossProfit = salesAmountTotal - cogsTotal
    const grossMargin = salesAmountTotal > 0 ? grossProfit / salesAmountTotal : 0
    const cashCollectionRatio = salesAmountTotal > 0 ? Math.min(1, Math.max(0, cashReceivedTotal / salesAmountTotal)) : 0
    const cashCogsTotal = cogsTotal * cashCollectionRatio
    const cashGrossProfit = cashReceivedTotal - cashCogsTotal
    const cashGrossMargin = cashReceivedTotal > 0 ? cashGrossProfit / cashReceivedTotal : 0

    return {
      ...product,
      sales_qty_total: salesQtyTotal,
      sales_amount_total: salesAmountTotal,
      cogs_total: cogsTotal,
      gross_profit: grossProfit,
      gross_margin: grossMargin,
      cash_received_total: cashReceivedTotal,
      cash_cogs_total: cashCogsTotal,
      cash_gross_profit: cashGrossProfit,
      cash_gross_margin: cashGrossMargin,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">商品利潤分析</h1>
          <p className="text-muted-foreground">查看帳面毛利與實收現金毛利，支援指定日期區間</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/products">
            <ArrowLeft className="mr-2 h-4 w-4" />
            回商品管理
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
              <Link href="/products/profit-analysis">清除</Link>
            </Button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/products/profit-analysis?startDate=${toDateKey(thisMonthStart)}&endDate=${toDateKey(now)}`}>本月</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/products/profit-analysis?startDate=${toDateKey(lastMonthStart)}&endDate=${toDateKey(lastMonthEnd)}`}>上個月</Link>
          </Button>
        </div>
      </div>

      <ProfitAnalysisTable products={productsWithProfit} />
    </div>
  )
}
