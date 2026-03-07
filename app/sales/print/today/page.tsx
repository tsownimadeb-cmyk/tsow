import { createClient } from "@/lib/supabase/server"
import type { Customer, Product, SalesOrder, SalesOrderItem } from "@/lib/types"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import { TodayPrintControls } from "@/components/sales/today-print-controls"

type SalesHeaderRow = Pick<SalesOrder, "id" | "order_no" | "customer_cno" | "delivery_method" | "order_date" | "total_amount" | "notes" | "created_at">
type SalesItemRow = Pick<SalesOrderItem, "id" | "sales_order_id" | "code" | "quantity" | "unit_price" | "subtotal" | "created_at">

const IN_FILTER_CHUNK_SIZE = 50

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function getTaipeiTodayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = formatter.formatToParts(new Date())
  const year = parts.find((part) => part.type === "year")?.value || ""
  const month = parts.find((part) => part.type === "month")?.value || ""
  const day = parts.find((part) => part.type === "day")?.value || ""
  return `${year}-${month}-${day}`
}

function formatZhTwDate(dateText: string) {
  const date = new Date(dateText)
  if (Number.isNaN(date.getTime())) return dateText
  return date.toLocaleDateString("zh-TW")
}

async function fetchTodaySales(supabase: Awaited<ReturnType<typeof createClient>>, todayIsoDate: string) {
  const result = await supabase
    .from("sales_orders")
    .select("id,order_no,customer_cno,delivery_method,order_date,total_amount,notes,created_at")
    .eq("order_date", todayIsoDate)
    .order("created_at", { ascending: true })

  if (result.error) {
    return { data: [] as SalesHeaderRow[], warning: result.error.message || "查詢今日銷貨單失敗" }
  }

  return { data: (result.data || []) as SalesHeaderRow[], warning: null as string | null }
}

async function fetchSalesItemsByOrderIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  salesOrderIds: string[],
) {
  if (!salesOrderIds.length) {
    return { data: [] as SalesItemRow[], warning: null as string | null }
  }

  const rows: SalesItemRow[] = []
  for (const idChunk of chunkArray(salesOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase
      .from("sales_order_items")
      .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
      .in("sales_order_id", idChunk)

    if (result.error) {
      return { data: [] as SalesItemRow[], warning: result.error.message || "查詢銷貨明細失敗" }
    }

    rows.push(...((result.data || []) as SalesItemRow[]))
  }

  return { data: rows, warning: null as string | null }
}

async function fetchCustomersByCodes(supabase: Awaited<ReturnType<typeof createClient>>, customerCodes: string[]) {
  if (!customerCodes.length) {
    return { data: [] as Customer[], warning: null as string | null }
  }

  const rows: Customer[] = []
  for (const codeChunk of chunkArray(customerCodes, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase.from("customers").select("code,name").in("code", codeChunk)

    if (result.error) {
      return { data: [] as Customer[], warning: result.error.message || "查詢客戶資料失敗" }
    }

    rows.push(...((result.data || []) as Customer[]))
  }

  return { data: rows, warning: null as string | null }
}

async function fetchProductsByCodes(supabase: Awaited<ReturnType<typeof createClient>>, productCodes: string[]) {
  if (!productCodes.length) {
    return { data: [] as Product[], warning: null as string | null }
  }

  const rows: Product[] = []
  for (const codeChunk of chunkArray(productCodes, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase.from("products").select("code,name,spec,unit").in("code", codeChunk)

    if (result.error) {
      return { data: [] as Product[], warning: result.error.message || "查詢商品資料失敗" }
    }

    rows.push(...((result.data || []) as Product[]))
  }

  return { data: rows, warning: null as string | null }
}

export default async function TodaySalesPrintPage() {
  const todayIsoDate = getTaipeiTodayIsoDate()
  const supabase = await createClient()

  const { data: salesRows, warning: salesWarning } = await fetchTodaySales(supabase, todayIsoDate)

  const salesOrderIds = salesRows
    .map((row) => String(row.id || "").trim())
    .filter(Boolean)

  const { data: salesItems, warning: itemsWarning } = await fetchSalesItemsByOrderIds(supabase, salesOrderIds)

  const customerCodes = Array.from(
    new Set(
      salesRows
        .map((row) => String(row.customer_cno || "").trim())
        .filter(Boolean),
    ),
  )
  const { data: customers, warning: customerWarning } = await fetchCustomersByCodes(supabase, customerCodes)

  const productCodes = Array.from(
    new Set(
      salesItems
        .map((item) => String(item.code || "").trim())
        .filter(Boolean),
    ),
  )
  const { data: products, warning: productWarning } = await fetchProductsByCodes(supabase, productCodes)

  const customerMap = new Map(customers.map((customer) => [String(customer.code), String(customer.name)]))
  const productMap = new Map(products.map((product) => [String(product.code), String(product.name)]))

  const itemsBySalesOrderId = new Map<string, SalesItemRow[]>()
  for (const item of salesItems) {
    const salesOrderId = String(item.sales_order_id || "").trim()
    if (!salesOrderId) continue
    const current = itemsBySalesOrderId.get(salesOrderId) || []
    current.push(item)
    itemsBySalesOrderId.set(salesOrderId, current)
  }

  const deliveryMethodMap: Record<string, string> = {
    self_delivery: "本車配送",
    company_delivery: "公司配送",
    customer_pickup: "客戶自取",
  }

  const totalAmount = salesRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
  const totalQuantity = salesItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const warnings = [salesWarning, itemsWarning, customerWarning, productWarning].filter(Boolean)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 print:max-w-none print:space-y-2 print:p-0">
      <style>{`
        @media screen {
          body.print-preview-mode {
            background: #e5e7eb;
          }
          body.print-preview-mode .print-preview-canvas {
            width: 210mm;
            max-width: calc(100vw - 2rem);
            margin-left: auto;
            margin-right: auto;
            background: #fff;
            padding: 10mm;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
          }
          body.print-preview-mode .print-preview-canvas .print-muted {
            color: #4b5563 !important;
          }
        }
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .print-break-avoid { break-inside: avoid; page-break-inside: avoid; }
          .print-only-border { border-color: #999 !important; }
          .print-muted { color: #444 !important; }
          .print\:flex-row { flex-direction: row !important; }
          .print\:w-\[70mm\] { width: 70mm !important; }
          .print\:border-r { border-right: 1px dashed #999 !important; }
          .print\:last\:border-r-0:last-child { border-right: 0 !important; }
        }
      `}</style>

      <div className="print-preview-canvas space-y-4 print:space-y-2">
        <header className="print-break-avoid rounded-lg border p-4 print-only-border print:hidden">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground print-muted">日期：{todayIsoDate}</p>
            </div>
            <TodayPrintControls />
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-md bg-muted px-3 py-2">今日單數：{salesRows.length}</div>
            <div className="rounded-md bg-muted px-3 py-2">今日總件數：{totalQuantity}</div>
            <div className="rounded-md bg-muted px-3 py-2">今日總金額：{formatCurrencyOneDecimal(totalAmount)}</div>
          </div>
        </header>


      {salesRows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground print-only-border">
          今日尚無銷貨單。
        </div>
      ) : (
        <section className="space-y-3">
          {salesRows.map((sale, index) => {
            const saleId = String(sale.id || "").trim()
            const items = itemsBySalesOrderId.get(saleId) || []
            const customerName = customerMap.get(String(sale.customer_cno || "").trim()) || "散客"
            const deliveryLabel = deliveryMethodMap[String(sale.delivery_method || "")] || "本車配送"
            const copies = ["存根聯", "客戶聯", "會計聯"]
            return (
              <div key={saleId || sale.order_no || String(index)} className="flex flex-col gap-4 print:flex-row print:gap-0">
                {copies.map((label, copyIdx) => (
                  <article
                    key={label}
                    className="print-break-avoid rounded-lg border p-4 print-only-border flex-1 print:border-r print:last:border-r-0 print:w-[70mm] print:box-border"
                    style={{ breakInside: 'avoid' }}
                  >
                    <div className="text-xs font-bold mb-2">{label}</div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-base font-semibold">{sale.order_no || "(未命名單號)"}</p>
                        <p className="text-sm text-muted-foreground print-muted">
                          {customerName} | {formatZhTwDate(String(sale.order_date || todayIsoDate))} | 配送：{deliveryLabel}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground print-muted">金額</p>
                        <p className="font-semibold">{formatCurrencyOneDecimal(Number(sale.total_amount || 0))}</p>
                      </div>
                    </div>
                    <div className="mb-3 overflow-x-auto rounded-md border print-only-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">商品</th>
                            <th className="px-3 py-2 text-right font-medium">數量</th>
                            <th className="px-3 py-2 text-right font-medium">單價</th>
                            <th className="px-3 py-2 text-right font-medium">小計</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.length === 0 ? (
                            <tr>
                              <td className="px-3 py-3 text-center text-muted-foreground print-muted" colSpan={4}>
                                無商品明細
                              </td>
                            </tr>
                          ) : (
                            items.map((item) => {
                              const productName = productMap.get(String(item.code || "").trim()) || String(item.code || "-")
                              return (
                                <tr key={item.id} className="border-t print-only-border">
                                  <td className="px-3 py-2">{productName}</td>
                                  <td className="px-3 py-2 text-right">{Number(item.quantity || 0)}</td>
                                  <td className="px-3 py-2 text-right">{formatCurrencyOneDecimal(Number(item.unit_price || 0))}</td>
                                  <td className="px-3 py-2 text-right">{formatCurrencyOneDecimal(Number(item.subtotal || 0))}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="rounded-md border px-3 py-2 print-only-border">備註：{sale.notes || "-"}</div>
                    </div>
                  </article>
                ))}
              </div>
            )
          })}
        </section>
      )}

        {warnings.length > 0 && (
          <div className="text-xs text-muted-foreground print:hidden">資料提示：{warnings.join("；")}</div>
        )}
      </div>
    </div>
  )
}
