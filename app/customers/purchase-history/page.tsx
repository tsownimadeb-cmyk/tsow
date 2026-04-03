import { unstable_noStore as noStore } from "next/cache"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PurchaseHistoryMobileCard } from "@/components/customers/purchase-history-mobile-card"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CustomerKeywordAutocomplete } from "@/components/customers/customer-keyword-autocomplete"

type CustomerRow = {
  code: string
  name: string | null
}

type SalesOrderRow = {
  id: string
  order_no: string
  customer_cno: string | null
  order_date: string
  total_amount: number | null
  is_paid: boolean | null
}

type SalesItemRow = {
  sales_order_id: string
  code: string | null
  quantity: number | null
  unit_price: number | null
  subtotal: number | null
}

type ProductRow = {
  code: string
  name: string | null
  cost: number | null
}

type AccountsReceivableRow = {
  sales_order_id: string | null
  status: "unpaid" | "partially_paid" | "paid" | null
  amount_due: number | null
  paid_amount: number | null
}

type CustomerLifetimeValueRow = {
  customerCode: string
  customerName: string
  firstOrderDate: string | null
  lastOrderDate: string | null
  orderCount: number
  totalSalesAmount: number
  averageOrderAmount: number
  totalGrossProfit: number
  totalUncollectedAmount: number
}

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeText = (value: unknown) => String(value ?? "").trim()
const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()
const CHUNK_SIZE = 50

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

const formatDate = (value: string | null) => {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("zh-TW")
}

interface CustomerPurchaseHistoryPageProps {
  searchParams?:
    | {
        customer?: string
        customerKeyword?: string
        customerCode?: string
        startDate?: string
        endDate?: string
      }
    | Promise<{
        customer?: string
        customerKeyword?: string
        customerCode?: string
        startDate?: string
        endDate?: string
      }>
}

export default async function CustomerPurchaseHistoryPage({ searchParams }: CustomerPurchaseHistoryPageProps) {
  noStore()
  const supabase = await createClient()
  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedCustomerCode = normalizeText(resolvedSearchParams?.customerCode)
  const customerKeyword = normalizeText(resolvedSearchParams?.customerKeyword || resolvedSearchParams?.customer)
  const startDate = normalizeText(resolvedSearchParams?.startDate)
  const endDate = normalizeText(resolvedSearchParams?.endDate)

  const { data: customersData, error: customersError } = await supabase.from("customers").select("code,name").order("code", { ascending: true })

  const customers = (customersData || []) as CustomerRow[]
  const matchedCustomerCodes = selectedCustomerCode
    ? [selectedCustomerCode]
    : customerKeyword
    ? customers
        .filter((customer) => {
          const code = normalizeText(customer.code).toLowerCase()
          const name = normalizeText(customer.name).toLowerCase()
          const keyword = customerKeyword.toLowerCase()
          return code.includes(keyword) || name.includes(keyword)
        })
        .map((customer) => normalizeText(customer.code))
    : []

  let salesOrdersQuery = supabase
    .from("sales_orders")
    .select("id,order_no,customer_cno,order_date,total_amount,is_paid")
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (selectedCustomerCode) {
    salesOrdersQuery = salesOrdersQuery.eq("customer_cno", selectedCustomerCode)
  } else if (customerKeyword) {
    if (matchedCustomerCodes.length > 0) {
      salesOrdersQuery = salesOrdersQuery.in("customer_cno", matchedCustomerCodes)
    } else {
      salesOrdersQuery = salesOrdersQuery.eq("customer_cno", "__NO_MATCH__")
    }
  }
  if (startDate) {
    salesOrdersQuery = salesOrdersQuery.gte("order_date", startDate)
  }
  if (endDate) {
    salesOrdersQuery = salesOrdersQuery.lte("order_date", endDate)
  }

  const { data: salesOrdersData, error: salesOrdersError } = await salesOrdersQuery

  if (customersError || salesOrdersError) {
    const errorMessage = customersError?.message || salesOrdersError?.message || "讀取資料失敗"
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶購買履歷</h1>
          <p className="text-muted-foreground">讀取資料失敗</p>
        </div>
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{errorMessage}</CardContent>
        </Card>
      </div>
    )
  }

  const salesOrders = (salesOrdersData || []) as SalesOrderRow[]
  const salesOrderIds = salesOrders.map((row) => normalizeText(row.id)).filter(Boolean)

  const salesItems: SalesItemRow[] = []
  const receivables: AccountsReceivableRow[] = []

  if (salesOrderIds.length) {
    for (const idChunk of chunkArray(salesOrderIds, CHUNK_SIZE)) {
      const { data: chunkItems, error: chunkItemsError } = await supabase
        .from("sales_order_items")
        .select("sales_order_id,code,quantity,unit_price,subtotal")
        .in("sales_order_id", idChunk)

      if (chunkItemsError) {
        console.error("Error fetching sales_order_items chunk", {
          chunkSize: idChunk.length,
          sampleSalesOrderId: idChunk[0] || null,
          message: chunkItemsError.message,
          details: chunkItemsError.details,
          hint: chunkItemsError.hint,
          code: chunkItemsError.code,
        })
      } else if (chunkItems?.length) {
        salesItems.push(...(chunkItems as SalesItemRow[]))
      }

      const { data: chunkReceivables, error: chunkArError } = await supabase
        .from("accounts_receivable")
        .select("sales_order_id,status,amount_due,paid_amount")
        .in("sales_order_id", idChunk)

      if (chunkArError) {
        console.error("Error fetching accounts_receivable chunk", {
          chunkSize: idChunk.length,
          sampleSalesOrderId: idChunk[0] || null,
          message: chunkArError.message,
          details: chunkArError.details,
          hint: chunkArError.hint,
          code: chunkArError.code,
        })
      } else if (chunkReceivables?.length) {
        receivables.push(...(chunkReceivables as AccountsReceivableRow[]))
      }
    }
  }

  const productCodes = Array.from(new Set(salesItems.map((item) => normalizeCode(item.code)).filter(Boolean)))
  const products: ProductRow[] = []
  if (productCodes.length) {
    for (const codeChunk of chunkArray(productCodes, CHUNK_SIZE)) {
      const { data: chunkProducts, error: chunkProductsError } = await supabase
        .from("products")
        .select("code,name,cost")
        .in("code", codeChunk)

      if (chunkProductsError) {
        console.error("Error fetching products chunk", {
          chunkSize: codeChunk.length,
          sampleCode: codeChunk[0] || null,
          message: chunkProductsError.message,
          details: chunkProductsError.details,
          hint: chunkProductsError.hint,
          code: chunkProductsError.code,
        })
      } else if (chunkProducts?.length) {
        products.push(...(chunkProducts as ProductRow[]))
      }
    }
  }
  const customerNameMap = new Map(customers.map((customer) => [normalizeText(customer.code), normalizeText(customer.name) || normalizeText(customer.code)]))
  const productMap = new Map(
    products.map((product) => [normalizeCode(product.code), { name: normalizeText(product.name) || normalizeText(product.code), cost: toSafeNumber(product.cost) }]),
  )
  const orderItemsMap = new Map<string, SalesItemRow[]>()
  const receivableByOrderId = new Map<string, AccountsReceivableRow>()

  for (const item of salesItems) {
    const salesOrderId = normalizeText(item.sales_order_id)
    if (!salesOrderId) continue
    const current = orderItemsMap.get(salesOrderId) || []
    current.push(item)
    orderItemsMap.set(salesOrderId, current)
  }

  for (const receivable of receivables) {
    const salesOrderId = normalizeText(receivable.sales_order_id)
    if (!salesOrderId || receivableByOrderId.has(salesOrderId)) continue
    receivableByOrderId.set(salesOrderId, receivable)
  }

  const grossProfitByOrderId = new Map<string, number>()
  for (const [salesOrderId, items] of orderItemsMap) {
    let totalGrossProfit = 0
    for (const item of items) {
      const code = normalizeCode(item.code)
      const quantity = toSafeNumber(item.quantity)
      const subtotal = toSafeNumber(item.subtotal)
      const itemCost = toSafeNumber(productMap.get(code)?.cost)
      totalGrossProfit += subtotal - quantity * itemCost
    }
    grossProfitByOrderId.set(salesOrderId, totalGrossProfit)
  }

  const summaryByCustomerCode = new Map<string, CustomerLifetimeValueRow>()
  const matchedCustomerCodeSet = new Set(matchedCustomerCodes)
  const customersForSummary = customerKeyword
    ? customers.filter((customer) => matchedCustomerCodeSet.has(normalizeText(customer.code)))
    : customers

  for (const customer of customersForSummary) {
    const customerCode = normalizeText(customer.code)
    if (!customerCode) continue
    summaryByCustomerCode.set(customerCode, {
      customerCode,
      customerName: normalizeText(customer.name) || customerCode,
      firstOrderDate: null,
      lastOrderDate: null,
      orderCount: 0,
      totalSalesAmount: 0,
      averageOrderAmount: 0,
      totalGrossProfit: 0,
      totalUncollectedAmount: 0,
    })
  }

  for (const order of salesOrders) {
    const customerCode = normalizeText(order.customer_cno)
    if (!customerCode) continue

    const summary =
      summaryByCustomerCode.get(customerCode) || {
        customerCode,
        customerName: customerNameMap.get(customerCode) || customerCode,
        firstOrderDate: null,
        lastOrderDate: null,
        orderCount: 0,
        totalSalesAmount: 0,
        averageOrderAmount: 0,
        totalGrossProfit: 0,
        totalUncollectedAmount: 0,
      }

    const orderDate = normalizeText(order.order_date)
    if (orderDate) {
      if (!summary.firstOrderDate || orderDate < summary.firstOrderDate) summary.firstOrderDate = orderDate
      if (!summary.lastOrderDate || orderDate > summary.lastOrderDate) summary.lastOrderDate = orderDate
    }

    const orderId = normalizeText(order.id)
    summary.orderCount += 1
    summary.totalSalesAmount += toSafeNumber(order.total_amount)
    summary.totalGrossProfit += toSafeNumber(grossProfitByOrderId.get(orderId))

    const receivable = receivableByOrderId.get(orderId)
    if (receivable) {
      const uncollected = Math.max(0, toSafeNumber(receivable.amount_due) - toSafeNumber(receivable.paid_amount))
      summary.totalUncollectedAmount += uncollected
    } else if (order.is_paid !== true) {
      summary.totalUncollectedAmount += toSafeNumber(order.total_amount)
    }

    summaryByCustomerCode.set(customerCode, summary)
  }

  const customerSummaryRows = Array.from(summaryByCustomerCode.values())
    .map((row) => ({
      ...row,
      averageOrderAmount: row.orderCount > 0 ? row.totalSalesAmount / row.orderCount : 0,
    }))
    .sort((left, right) => right.totalGrossProfit - left.totalGrossProfit)

  const timelineRows = salesOrders
    .map((order) => {
      const orderId = normalizeText(order.id)
      const customerCode = normalizeText(order.customer_cno)
      const orderItems = orderItemsMap.get(orderId) || []
      const firstItem = orderItems[0]
      const firstCode = normalizeCode(firstItem?.code)
      const firstProductName = productMap.get(firstCode)?.name || firstCode || "未知商品"
      const itemSummary = orderItems.length === 0
        ? "-"
        : orderItems.length === 1
          ? firstProductName
          : `${firstProductName} 等 ${orderItems.length} 件`

      const firstUnitPrice = toSafeNumber(firstItem?.unit_price)
      const unitPriceSummary = orderItems.length === 0
        ? "-"
        : orderItems.length === 1
          ? formatCurrencyOneDecimal(firstUnitPrice)
          : `${formatCurrencyOneDecimal(firstUnitPrice)} 等 ${orderItems.length} 件`

      const totalQuantity = orderItems.reduce((sum, item) => sum + toSafeNumber(item.quantity), 0)

      return {
        orderDate: normalizeText(order.order_date),
        orderNo: normalizeText(order.order_no) || "-",
        customerName: customerNameMap.get(customerCode) || customerCode || "散客",
        itemSummary,
        unitPriceSummary,
        totalQuantity,
        totalAmount: toSafeNumber(order.total_amount),
      }
    })
    .sort((left, right) => right.orderDate.localeCompare(left.orderDate))

  const exportQuery = new URLSearchParams()
  if (selectedCustomerCode) exportQuery.set("customerCode", selectedCustomerCode)
  if (startDate) exportQuery.set("startDate", startDate)
  if (endDate) exportQuery.set("endDate", endDate)
  const exportHref = `/api/customers/purchase-history/timeline-export?${exportQuery.toString()}`

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">客戶購買履歷</h1>
          <p className="text-muted-foreground">查看客戶終身價值與每張銷貨單時間軸</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/customers">返回客戶管理</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>篩選條件</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto_auto]" method="get" action="/customers/purchase-history">
            <CustomerKeywordAutocomplete
              name="customerKeyword"
              selectedCodeName="customerCode"
              defaultValue={customerKeyword}
              defaultSelectedCode={selectedCustomerCode}
              customers={customers.map((customer) => ({ code: normalizeText(customer.code), name: normalizeText(customer.name) || normalizeText(customer.code) }))}
              placeholder="輸入客戶代碼或名稱"
              aria-label="客戶模糊搜尋"
            />
            <Input type="date" name="startDate" defaultValue={startDate} aria-label="開始日期" />
            <Input type="date" name="endDate" defaultValue={endDate} aria-label="結束日期" />
            <Button type="submit">套用篩選</Button>
            {selectedCustomerCode ? (
              <Button type="button" variant="secondary" asChild>
                <Link href={exportHref}>匯出時間軸</Link>
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled>
                匯出時間軸
              </Button>
            )}
            <Button type="button" variant="outline" asChild>
              <Link href="/customers/purchase-history">清除</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <details>
            <summary className="cursor-pointer list-none text-lg font-semibold text-foreground">
              客戶購買時間軸
            </summary>
            <div className="mt-4">
              {/* 桌面版表格 */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>客戶</TableHead>
                      <TableHead>單號</TableHead>
                      <TableHead>品項</TableHead>
                      <TableHead>單價</TableHead>
                      <TableHead className="text-right">數量</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timelineRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          尚無銷貨資料
                        </TableCell>
                      </TableRow>
                    ) : (
                      timelineRows.map((row) => (
                        <TableRow key={`${row.orderNo}-${row.orderDate}-${row.customerName}`}>
                          <TableCell>{formatDate(row.orderDate)}</TableCell>
                          <TableCell>{row.customerName}</TableCell>
                          <TableCell>{row.orderNo}</TableCell>
                          <TableCell className="max-w-[520px] truncate" title={row.itemSummary}>
                            {row.itemSummary}
                          </TableCell>
                          <TableCell className="max-w-[320px] truncate" title={row.unitPriceSummary}>
                            {row.unitPriceSummary}
                          </TableCell>
                          <TableCell className="text-right">{row.totalQuantity.toLocaleString("zh-TW")}</TableCell>
                          <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalAmount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* 行動版卡片 */}
              <div className="block md:hidden space-y-3">
                {timelineRows.length === 0 ? (
                  <div className="text-center text-muted-foreground py-6">尚無銷貨資料</div>
                ) : (
                  timelineRows.map((row) => (
                    <PurchaseHistoryMobileCard
                      key={`${row.orderNo}-${row.orderDate}-${row.customerName}`}
                      orderDate={row.orderDate}
                      orderNo={row.orderNo}
                      customerName={row.customerName}
                      itemSummary={row.itemSummary}
                      unitPriceSummary={row.unitPriceSummary}
                      totalQuantity={row.totalQuantity}
                      totalAmount={row.totalAmount}
                    />
                  ))
                )}
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <details>
            <summary className="cursor-pointer list-none text-lg font-semibold text-foreground">
              客戶終身價值總表
            </summary>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>客戶</TableHead>
                    <TableHead>首購日</TableHead>
                    <TableHead>末購日</TableHead>
                    <TableHead className="text-right">總訂單數</TableHead>
                    <TableHead className="text-right">總營業額</TableHead>
                    <TableHead className="text-right">平均客單</TableHead>
                    <TableHead className="text-right">毛利</TableHead>
                    <TableHead className="text-right">未收款金額</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerSummaryRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        尚無客戶資料
                      </TableCell>
                    </TableRow>
                  ) : (
                    customerSummaryRows.map((row) => (
                      <TableRow key={row.customerCode}>
                        <TableCell>{row.customerName}</TableCell>
                        <TableCell>{formatDate(row.firstOrderDate)}</TableCell>
                        <TableCell>{formatDate(row.lastOrderDate)}</TableCell>
                        <TableCell className="text-right">{row.orderCount.toLocaleString("zh-TW")}</TableCell>
                        <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalSalesAmount)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyOneDecimal(row.averageOrderAmount)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalGrossProfit)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyOneDecimal(row.totalUncollectedAmount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}