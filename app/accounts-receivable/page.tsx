import { createClient } from "@/lib/supabase/server"
import { ARTableClient } from "@/components/accounts-receivable/ar-table-client"
import { CustomerStatementReceivablePanel } from "@/components/accounts-receivable/customer-statement-receivable-panel"
import type { AccountsReceivable, Customer } from "@/lib/types"
import Link from "next/link"

export const metadata = {
  title: "應收帳款管理",
  description: "管理應收帳款記錄",
}

export const dynamic = "force-dynamic"

export default async function ARPage(props: any) {
  try {
    const searchParams = await props.searchParams
    const PAGE_SIZE = 20
    let page = 1
    let searchText = ""
    let viewMode: "all" | "unpaid" = "unpaid"

    if (searchParams && typeof searchParams === "object") {
      const rawPage = searchParams.page
      const parsed = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage)
      if (!Number.isNaN(parsed) && parsed > 0) page = parsed

      const rawSearch = searchParams.search
      searchText = String(Array.isArray(rawSearch) ? rawSearch[0] : rawSearch || "").trim()

      const rawView = searchParams.view
      const normalizedView = String(Array.isArray(rawView) ? rawView[0] : rawView || "").trim().toLowerCase()
      if (normalizedView === "all") {
        viewMode = "all"
      }
    }

    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const supabase = await createClient()
    const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase()
    const escapeLikeValue = (value: string) =>
      value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_")
        .replaceAll(",", "\\,")
    const quoteInValue = (value: string) => `"${value.replaceAll('"', '\\"')}"`
    const CHUNK_SIZE = 50
    const salesOrderItemsFetchErrors: string[] = []

    const logSupabaseChunkError = (label: string, error: unknown, meta: Record<string, unknown> = {}) => {
      const normalized = {
        message: (error as { message?: string })?.message || null,
        details: (error as { details?: string })?.details || null,
        hint: (error as { hint?: string })?.hint || null,
        code: (error as { code?: string })?.code || null,
      }
      const ownProps = error && typeof error === "object" ? Object.getOwnPropertyNames(error) : []
      const serialized = error && typeof error === "object"
        ? JSON.stringify(error, ownProps)
        : String(error)

      console.error(label, {
        ...meta,
        normalized,
        ownProps,
        serialized,
        raw: error,
      })
    }

    const chunkArray = <T,>(items: T[], size: number) => {
      const chunks: T[][] = []
      for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size))
      }
      return chunks
    }

    let salesQuery = supabase
      .from("sales_orders")
      .select("id,order_no,customer_cno,order_date,total_amount,status,is_paid,notes,created_at,updated_at", { count: "exact" })

    if (viewMode === "unpaid") {
      salesQuery = salesQuery.eq("is_paid", false)
    }

    if (searchText !== "") {
      const likeKeyword = escapeLikeValue(searchText)
      const { data: matchedCustomers } = await supabase
        .from("customers")
        .select("*")
        .or(`code.ilike.%${likeKeyword}%,name.ilike.%${likeKeyword}%`)
        .limit(200)

      const matchedCodes = Array.from(
        new Set(
          (matchedCustomers || []).flatMap((customer: { code?: string | null; cno?: string | null }) =>
            [customer.code, customer.cno]
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          ),
        ),
      )

      const filters = [
        `order_no.ilike.%${likeKeyword}%`,
        `customer_cno.ilike.%${likeKeyword}%`,
        `notes.ilike.%${likeKeyword}%`,
      ]

      if (matchedCodes.length > 0) {
        filters.push(`customer_cno.in.(${matchedCodes.map(quoteInValue).join(",")})`)
      }

      salesQuery = salesQuery.or(filters.join(","))
    }

    salesQuery = salesQuery
      .order("customer_cno", { ascending: true, nullsFirst: false })
      .order("order_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, to)

    const { data: salesOrders, error: salesError, count: salesOrderCount } = await salesQuery

    if (salesError) {
      console.error("Error fetching sales orders:", salesError)
      return (
        <div className="p-6">
          <h1 className="text-3xl font-bold mb-6">應收帳款管理</h1>
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
            <p className="text-destructive font-semibold">無法載入銷貨資料</p>
            <p className="text-sm text-destructive/80">{salesError.message}</p>
          </div>
        </div>
      )
    }

    const primarySalesOrders = salesOrders || []
    const total = salesOrderCount ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    const currentPageCustomerCodes = Array.from(
      new Set(
        primarySalesOrders
          .map((so) => String(so.customer_cno || "").trim())
          .filter(Boolean),
      ),
    )

    const relatedUnpaidSalesOrders: typeof primarySalesOrders = []
    if (currentPageCustomerCodes.length) {
      const customerChunks = chunkArray(currentPageCustomerCodes, CHUNK_SIZE)
      const relatedSalesResults = await Promise.allSettled(
        customerChunks.map((customerChunk) => {
          let relatedSalesQuery = supabase
            .from("sales_orders")
            .select("id,order_no,customer_cno,order_date,total_amount,status,is_paid,notes,created_at,updated_at")
            .in("customer_cno", customerChunk)

          if (viewMode === "unpaid") {
            relatedSalesQuery = relatedSalesQuery.eq("is_paid", false)
          }

          return relatedSalesQuery
            .order("customer_cno", { ascending: true, nullsFirst: false })
            .order("order_date", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
        }),
      )

      relatedSalesResults.forEach((result, index) => {
        const customerChunk = customerChunks[index] || []
        if (result.status === "rejected") {
          logSupabaseChunkError("Error fetching related unpaid sales orders", result.reason, {
            chunkSize: customerChunk.length,
            sampleCustomerCode: customerChunk[0] || null,
          })
          return
        }

        const { data: chunkOrders, error: chunkError } = result.value
        if (chunkError) {
          logSupabaseChunkError("Error fetching related unpaid sales orders", chunkError, {
            chunkSize: customerChunk.length,
            sampleCustomerCode: customerChunk[0] || null,
          })
          return
        }

        if (chunkOrders?.length) {
          relatedUnpaidSalesOrders.push(...chunkOrders)
        }
      })
    }

    const mergedSalesOrders = Array.from(
      new Map(
        [...primarySalesOrders, ...relatedUnpaidSalesOrders].map((so) => [String(so.id), so]),
      ).values(),
    ).sort(
      (a, b) => new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime(),
    )

    const salesOrderIds = mergedSalesOrders.map((so) => so.id)

    const salesOrderItems: Array<Record<string, unknown>> = []
    let salesOrderItemsFetchFailed = false
    const failedSalesOrderIds = new Set<string>()

    if (salesOrderIds.length) {
      const salesOrderIdChunks = chunkArray(salesOrderIds, CHUNK_SIZE)
      const chunkResults = await Promise.allSettled(
        salesOrderIdChunks.map((idChunk) =>
          supabase
            .from("sales_order_items")
            .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
            .in("sales_order_id", idChunk),
        ),
      )

      chunkResults.forEach((result, index) => {
        const idChunk = salesOrderIdChunks[index] || []

        if (result.status === "rejected") {
          salesOrderItemsFetchFailed = true
          idChunk.forEach((id) => failedSalesOrderIds.add(id))
          logSupabaseChunkError("Error fetching sales_order_items chunk", result.reason, {
            chunkSize: idChunk.length,
            sampleSalesOrderId: idChunk[0] || null,
          })
          salesOrderItemsFetchErrors.push("讀取 sales_order_items 分段資料失敗")
          return
        }

        const { data: chunkItems, error: chunkError } = result.value
        if (chunkError) {
          salesOrderItemsFetchFailed = true
          idChunk.forEach((id) => failedSalesOrderIds.add(id))
          logSupabaseChunkError("Error fetching sales_order_items chunk", chunkError, {
            chunkSize: idChunk.length,
            sampleSalesOrderId: idChunk[0] || null,
          })
          salesOrderItemsFetchErrors.push(
            (chunkError as { message?: string })?.message || "讀取 sales_order_items 分段資料失敗",
          )
          return
        }

        if (chunkItems?.length) {
          salesOrderItems.push(...(chunkItems as Array<Record<string, unknown>>))
        }
      })

      if (salesOrderItemsFetchFailed && failedSalesOrderIds.size > 0) {
        const recoveredSalesOrderIds = new Set<string>()
        const fallbackResults = await Promise.allSettled(
          Array.from(failedSalesOrderIds).map((salesOrderId) =>
            supabase
              .from("sales_order_items")
              .select("id,sales_order_id,code,quantity,unit_price,subtotal,created_at")
              .eq("sales_order_id", salesOrderId),
          ),
        )

        fallbackResults.forEach((result, index) => {
          const salesOrderId = Array.from(failedSalesOrderIds)[index]
          if (!salesOrderId) return

          if (result.status === "rejected") {
            logSupabaseChunkError("Fallback fetch failed for sales_order_items", result.reason, { salesOrderId })
            return
          }

          const { data: fallbackItems, error: fallbackError } = result.value
          if (fallbackError) {
            logSupabaseChunkError("Fallback fetch failed for sales_order_items", fallbackError, { salesOrderId })
            return
          }

          if (fallbackItems?.length) {
            salesOrderItems.push(...(fallbackItems as Array<Record<string, unknown>>))
          }
          recoveredSalesOrderIds.add(salesOrderId)
        })

        recoveredSalesOrderIds.forEach((id) => failedSalesOrderIds.delete(id))
        salesOrderItemsFetchFailed = failedSalesOrderIds.size > 0
      }
    }

    const dedupedSalesOrderItems = Array.from(
      new Map(
        salesOrderItems.map((item) => {
          const id = String((item as { id?: string | null }).id || "")
          const fallbackKey = [
            String((item as { sales_order_id?: string | null }).sales_order_id || ""),
            String((item as { code?: string | null }).code || ""),
            String((item as { created_at?: string | null }).created_at || ""),
          ].join("|")
          return [id || fallbackKey, item]
        }),
      ).values(),
    )

    const productCodes = Array.from(
      new Set(
        dedupedSalesOrderItems
          .map((item) => normalizeCode((item as { code?: string | null }).code))
          .filter((code): code is string => Boolean(code)),
      ),
    )

    const products: Array<Record<string, unknown>> = []
    if (productCodes.length) {
      const productCodeChunks = chunkArray(productCodes, CHUNK_SIZE)
      const productChunkResults = await Promise.allSettled(
        productCodeChunks.map((codeChunk) =>
          supabase
            .from("products")
            .select("code,name,unit")
            .in("code", codeChunk),
        ),
      )

      productChunkResults.forEach((result, index) => {
        const codeChunk = productCodeChunks[index] || []
        if (result.status === "rejected") {
          logSupabaseChunkError("Error fetching products chunk", result.reason, {
            chunkSize: codeChunk.length,
            sampleCode: codeChunk[0] || null,
          })
          return
        }

        const { data: chunkProducts, error: chunkError } = result.value
        if (chunkError) {
          logSupabaseChunkError("Error fetching products chunk", chunkError, {
            chunkSize: codeChunk.length,
            sampleCode: codeChunk[0] || null,
          })
          return
        }

        if (chunkProducts?.length) {
          products.push(...(chunkProducts as Array<Record<string, unknown>>))
        }
      })
    }

    const productMap = new Map(
      products.map((product) => [normalizeCode((product as { code?: string | null }).code), product]),
    )

    const salesOrderItemsMap = dedupedSalesOrderItems.reduce((map, item) => {
      const itemCode = (item as { code?: string | null }).code
      const salesOrderId = String((item as { sales_order_id?: string | null }).sales_order_id || "")
      if (!salesOrderId) return map

      const productCode = normalizeCode(itemCode)
      const current = map.get(salesOrderId) || []
      current.push({
        ...item,
        product_pno: itemCode || null,
        code: productCode || null,
        product: productCode ? productMap.get(productCode) : undefined,
      })
      map.set(salesOrderId, current)
      return map
    }, new Map<string, Array<Record<string, unknown>>>())

    const arRows: Array<Record<string, any>> = []
    let arErrorMessage: string | null = null

    if (salesOrderIds.length) {
      const arIdChunks = chunkArray(salesOrderIds, CHUNK_SIZE)
      const arResults = await Promise.allSettled(
        arIdChunks.map((idChunk) =>
          supabase
            .from("accounts_receivable")
            .select("*")
            .in("sales_order_id", idChunk),
        ),
      )

      arResults.forEach((result, index) => {
        const idChunk = arIdChunks[index] || []

        if (result.status === "rejected") {
          if (!arErrorMessage) {
            arErrorMessage = "讀取 accounts_receivable 分段資料失敗"
          }
          logSupabaseChunkError("Error fetching accounts_receivable chunk", result.reason, {
            chunkSize: idChunk.length,
            sampleSalesOrderId: idChunk[0] || null,
          })
          return
        }

        const { data: chunkRows, error: chunkError } = result.value
        if (chunkError) {
          if (!arErrorMessage) {
            arErrorMessage = chunkError.message || "讀取 accounts_receivable 分段資料失敗"
          }
          logSupabaseChunkError("Error fetching accounts_receivable chunk", chunkError, {
            chunkSize: idChunk.length,
            sampleSalesOrderId: idChunk[0] || null,
          })
          return
        }

        if (chunkRows?.length) {
          arRows.push(...chunkRows)
        }
      })
    }

    if (arErrorMessage) {
      console.error("Error fetching accounts_receivable:", arErrorMessage)
    }

    const arMap = arRows.reduce((map, row) => {
      if (!row.sales_order_id) return map

      const current = map.get(row.sales_order_id)
      if (!current) {
        map.set(row.sales_order_id, row)
        return map
      }

      const currentUpdatedAt = new Date(current.updated_at || current.created_at || 0).getTime()
      const candidateUpdatedAt = new Date(row.updated_at || row.created_at || 0).getTime()

      if (candidateUpdatedAt > currentUpdatedAt) {
        map.set(row.sales_order_id, row)
      }

      return map
    }, new Map<string, any>())

    const { data: customers } = await supabase
      .from("customers")
      .select("*")
      .order("code", { ascending: true })

    const customersList = (customers || []) as Array<Customer & { cno?: string | null }>
    const customerMap = new Map(
      customersList.flatMap((customer) => {
        const keys = Array.from(
          new Set(
            [customer.code, customer.cno]
              .map((value) => normalizeCode(value))
              .filter(Boolean),
          ),
        )

        return keys.map((key) => [key, customer] as const)
      }),
    )

    const enrichedRecords: AccountsReceivable[] = mergedSalesOrders
      .map((so) => {
        const existing = arMap.get(so.id)
        const salesTotalAmount = Number(so.total_amount)
        const effectiveCustomerCno = existing?.customer_cno ?? so.customer_cno ?? null
        const existingAmountDue = existing ? Number(existing.amount_due ?? existing.total_amount ?? salesTotalAmount) : salesTotalAmount
        const amountDue = !Number.isFinite(existingAmountDue) || existingAmountDue <= 0 ? salesTotalAmount : existingAmountDue

        const existingPaidAmount = existing
          ? Number(existing.paid_amount ?? (so.is_paid ? amountDue : 0))
          : so.is_paid
            ? amountDue
            : 0

        let paidAmount = Number.isFinite(existingPaidAmount)
          ? existingPaidAmount
          : so.is_paid
            ? amountDue
            : 0

        if (so.is_paid && paidAmount <= 0) {
          paidAmount = amountDue
        }

        if (paidAmount > amountDue) {
          paidAmount = amountDue
        }

        const status: AccountsReceivable["status"] = so.is_paid
          ? "paid"
          : paidAmount > 0
            ? "partially_paid"
            : "unpaid"

        const normalizedCustomerCno = String(effectiveCustomerCno || "").trim()
        const normalizedCustomerKey = normalizeCode(normalizedCustomerCno)

        return {
          id: existing?.id || `virtual-${so.id}`,
          sales_order_id: so.id,
          customer_cno: normalizedCustomerCno || null,
          amount_due: amountDue,
          paid_amount: paidAmount,
          overpaid_amount: Math.max(0, Number(existing?.overpaid_amount ?? 0) || 0),
          paid_at: existing?.paid_at || (so.is_paid ? so.updated_at : null),
          due_date: existing?.due_date || so.order_date,
          status,
          notes: existing?.notes || so.notes || null,
          created_at: existing?.created_at || so.created_at,
          updated_at: existing?.updated_at || so.updated_at,
          sales_order: {
            ...so,
            items: (salesOrderItemsMap.get(so.id) || []) as AccountsReceivable["sales_order"] extends { items?: infer T } ? T : never,
          },
          customer: normalizedCustomerKey ? customerMap.get(normalizedCustomerKey) : undefined,
        }
      })

    const hasActiveSearch = searchText !== ""
    const initialShowAllCustomers = viewMode === "all"
    const shouldRenderTable = enrichedRecords.length > 0 || hasActiveSearch

    function getPageUrl(targetPage: number) {
      const params = new URLSearchParams()
      if (
        searchParams &&
        typeof searchParams === "object" &&
        !Array.isArray(searchParams) &&
        searchParams !== null &&
        searchParams.constructor === Object
      ) {
        for (const [key, value] of Object.entries(searchParams)) {
          if (key === "page") continue
          if (typeof value === "string") params.set(key, value)
          else if (Array.isArray(value) && value.length > 0) params.set(key, value[0])
        }
      }
      params.set("page", String(targetPage))
      return `/accounts-receivable?${params.toString()}`
    }

    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">應收帳款管理</h1>
          <p className="text-muted-foreground mt-2">管理銷貨應收帳款記錄（每頁 {PAGE_SIZE} 筆）</p>
        </div>

        {/* <CustomerStatementReceivablePanel /> */}

        {arErrorMessage && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-1">
            <p className="text-sm text-destructive font-semibold">`accounts_receivable` 讀取失敗，已改用銷貨資料即時計算</p>
            <p className="text-xs text-destructive/80">{arErrorMessage}</p>
          </div>
        )}

        {salesOrderItemsFetchFailed && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-1">
            <p className="text-sm text-amber-700 font-semibold">`sales_order_items` 部分讀取失敗，且逐筆重試後仍有異常</p>
            <p className="text-xs text-amber-700/80">{salesOrderItemsFetchErrors[0] || "請查看伺服器日誌中的 chunk 錯誤詳情"}</p>
          </div>
        )}

        {!shouldRenderTable ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center space-y-2">
            <p className="text-lg font-semibold">目前沒有未收訂單</p>
            <p className="text-sm text-muted-foreground">目前所有訂單都已收款，或可稍後重新整理。</p>
            {page > 1 && (
              <div className="pt-2">
                <Link href={getPageUrl(1)} className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent">
                  回到第一頁
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <ARTableClient
              records={enrichedRecords}
              initialSearch={searchText}
              initialShowAllCustomers={initialShowAllCustomers}
              allCustomers={customersList.flatMap((customer) => {
                const keys = Array.from(
                  new Set(
                    [customer.code, customer.cno]
                      .map((value) => String(value || "").trim())
                      .filter(Boolean),
                  ),
                )

                return keys.map((key) => ({
                  code: key,
                  name: String(customer.name || "").trim(),
                }))
              })}
            />
          </div>
        )}

        <div className="flex items-center justify-center gap-4 mt-2">
          <Link
            href={getPageUrl(page - 1)}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : 0}
            className={`btn ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          >
            上一頁
          </Link>
          <span>第 {page} 頁 / 共 {totalPages} 頁（共 {total} 筆）</span>
          <Link
            href={getPageUrl(page + 1)}
            aria-disabled={page >= totalPages}
            tabIndex={page >= totalPages ? -1 : 0}
            className={`btn ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          >
            下一頁
          </Link>
          <form method="get" action="/accounts-receivable" className="flex items-center gap-2">
            <input
              type="number"
              name="page"
              min={1}
              max={totalPages}
              defaultValue={page}
              className="border rounded px-2 py-1 w-16 text-center"
              aria-label="跳至指定頁數"
            />
            <button type="submit" className="btn">跳頁</button>
          </form>
        </div>
      </div>
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "發生未知網路錯誤"
    console.error("ARPage fatal error:", {
      message,
      error,
    })

    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">應收帳款管理</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <p className="text-destructive font-semibold">載入應收帳款時發生網路錯誤</p>
          <p className="text-sm text-destructive/80">{message}</p>
        </div>
      </div>
    )
  }
}
