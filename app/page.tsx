import { createClient } from "@/lib/supabase/server"
import { DollarSign, HandCoins, TrendingUp } from "lucide-react"
import { StatsCard } from "@/components/dashboard/stats-card"
import { RevenueTrendChart } from "@/components/dashboard/revenue-trend-chart"

interface SalesOrderItemRow {
  product_code: string | null
  quantity: number
}

interface SalesOrderRow {
  order_date: string
  total_amount: number | string | null
  is_paid: boolean | null
  status: string | null
  sales_order_items?: SalesOrderItemRow[] | null
}

interface PurchaseOrderItemRow {
  product_code: string | null
  quantity: number
  unit_price: number | string | null
}

interface PurchaseOrderRow {
  status: string | null
  items?: PurchaseOrderItemRow[] | null
}

interface AccountsReceivableRow {
  amount_due: number | string | null
}

const TAIWAN_TIMEZONE = "Asia/Taipei"

const safeNumber = (value: number | string | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toDateKeyInTaiwan = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIWAN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ data: salesData }, { data: purchaseData }, { data: receivableData }] = await Promise.all([
    supabase.from("sales_orders").select("order_date,total_amount,is_paid,status,sales_order_items(product_code,quantity)"),
    supabase.from("purchase_orders").select("status,items:purchase_order_items(product_code,quantity,unit_price)"),
    supabase.from("accounts_receivable").select("amount_due").eq("status", "unpaid"),
  ])

  const salesOrders: SalesOrderRow[] = (salesData as SalesOrderRow[] | null) || []
  const purchaseOrders: PurchaseOrderRow[] = (purchaseData as PurchaseOrderRow[] | null) || []
  const receivables: AccountsReceivableRow[] = (receivableData as AccountsReceivableRow[] | null) || []

  const now = new Date()
  const today = toDateKeyInTaiwan(now)
  const monthPrefix = today.slice(0, 7)

  const isActiveOrder = (status: string | null | undefined) => status !== "cancelled"

  const todayRevenue = salesOrders
    .filter((order) => order.order_date === today && Boolean(order.is_paid) && isActiveOrder(order.status))
    .reduce((sum, order) => sum + safeNumber(order.total_amount), 0)

  const unpaidReceivables = receivables.reduce((sum, row) => sum + safeNumber(row.amount_due), 0)

  const monthlySalesOrders = salesOrders.filter(
    (order) => order.order_date?.startsWith(monthPrefix) && isActiveOrder(order.status),
  )

  const monthlySalesTotal = monthlySalesOrders.reduce((sum, order) => sum + safeNumber(order.total_amount), 0)

  const purchaseCostSummary = new Map<string, { totalCost: number; totalQty: number }>()
  for (const purchase of purchaseOrders) {
    if (!isActiveOrder(purchase.status)) continue
    for (const item of purchase.items || []) {
      if (!item.product_code) continue
      const current = purchaseCostSummary.get(item.product_code) || { totalCost: 0, totalQty: 0 }
      current.totalCost += safeNumber(item.unit_price) * safeNumber(item.quantity)
      current.totalQty += safeNumber(item.quantity)
      purchaseCostSummary.set(item.product_code, current)
    }
  }

  let monthlyEstimatedCost = 0
  for (const order of monthlySalesOrders) {
    for (const item of order.sales_order_items || []) {
      if (!item.product_code) continue
      const purchaseCost = purchaseCostSummary.get(item.product_code)
      if (!purchaseCost || purchaseCost.totalQty === 0) continue
      const avgCost = purchaseCost.totalCost / purchaseCost.totalQty
      monthlyEstimatedCost += avgCost * safeNumber(item.quantity)
    }
  }

  const monthlyEstimatedGrossProfit = monthlySalesTotal - monthlyEstimatedCost

  const lastSevenDays: string[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    lastSevenDays.push(toDateKeyInTaiwan(date))
  }

  const dailyRevenueMap = new Map(lastSevenDays.map((d) => [d, 0]))
  for (const order of salesOrders) {
    if (!Boolean(order.is_paid) || !isActiveOrder(order.status)) continue
    if (!dailyRevenueMap.has(order.order_date)) continue
    dailyRevenueMap.set(order.order_date, (dailyRevenueMap.get(order.order_date) || 0) + safeNumber(order.total_amount))
  }

  const revenueTrendData = lastSevenDays.map((date) => ({
    date: new Intl.DateTimeFormat("zh-TW", {
      timeZone: TAIWAN_TIMEZONE,
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(`${date}T00:00:00+08:00`)),
    fullDate: new Intl.DateTimeFormat("zh-TW", {
      timeZone: TAIWAN_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(`${date}T00:00:00+08:00`)),
    revenue: dailyRevenueMap.get(date) || 0,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">儀表板</h1>
        <p className="text-muted-foreground">營運概況與近七日營收趨勢</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="今日業績"
          value={`$${todayRevenue.toLocaleString()}`}
          icon={DollarSign}
          description="今日已付款銷貨總額"
        />
        <StatsCard
          title="待收帳款"
          value={`$${unpaidReceivables.toLocaleString()}`}
          icon={HandCoins}
          description="應收帳款未收款金額"
        />
        <StatsCard
          title="本月毛利預估"
          value={`$${monthlyEstimatedGrossProfit.toLocaleString()}`}
          icon={TrendingUp}
          description="本月銷貨總額 - 對應進貨成本"
        />
      </div>

      <RevenueTrendChart data={revenueTrendData} />
    </div>
  )
}
