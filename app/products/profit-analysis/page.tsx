import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import {
  fetchProductProfitSummaryByCode,
  fetchProductsRows,
  normalizeProducts,
  type ProductListRowWithProfit,
} from "@/lib/products"
import { Button } from "@/components/ui/button"
import { ProfitAnalysisTable } from "@/components/products/profit-analysis-table"

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()
const normalizeText = (value: unknown) => String(value ?? "").trim()
const EXCLUDED_PRODUCT_KEYWORDS = ["前年帳款"]

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export default async function ProductProfitAnalysisPage() {
  noStore()
  const supabase = await createClient()

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
  const { summaryByCode, warning: profitWarning } = await fetchProductProfitSummaryByCode(supabase, productCodes)

  if (profitWarning) {
    console.error("[ProductProfitAnalysisPage] 商品損益彙總查詢失敗:", profitWarning)
  }

  const productsWithProfit: ProductListRowWithProfit[] = filteredProducts.map((product) => {
    const key = normalizeCode(product.code)
    const summary = summaryByCode.get(key)
    const salesQtyTotal = toNumber(summary?.sales_qty_total)
    const salesAmountTotal = toNumber(summary?.sales_amount_total)
    const unitCost = toNumber(product.cost)
    const cogsTotal = salesQtyTotal * unitCost
    const grossProfit = salesAmountTotal - cogsTotal
    const grossMargin = salesAmountTotal > 0 ? grossProfit / salesAmountTotal : 0

    return {
      ...product,
      sales_qty_total: salesQtyTotal,
      sales_amount_total: salesAmountTotal,
      cogs_total: cogsTotal,
      gross_profit: grossProfit,
      gross_margin: grossMargin,
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">商品利潤分析</h1>
          <p className="text-muted-foreground">查看各商品已售數量、收入、成本與毛利表現</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/products">
            <ArrowLeft className="mr-2 h-4 w-4" />
            回商品管理
          </Link>
        </Button>
      </div>

      <ProfitAnalysisTable products={productsWithProfit} />
    </div>
  )
}
