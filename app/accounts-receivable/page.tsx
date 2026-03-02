import { createClient } from "@/lib/supabase/server"
import { ARTable } from "@/components/accounts-receivable/ar-table"
import type { AccountsReceivable } from "@/lib/types"

export const metadata = {
  title: "應收帳款管理",
  description: "管理應收帳款記錄",
}

export default async function ARPage() {
  const supabase = await createClient()
  const { data: salesOrders, error: salesError } = await supabase
    .from("sales_orders")
    .select("id,order_no,customer_cno,order_date,total_amount,status,is_paid,notes,created_at,updated_at")
    .order("created_at", { ascending: false })

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

  const customerCnos = (salesOrders || [])
    .map((so) => so.customer_cno)
    .filter((code): code is string => Boolean(code))

  const salesOrderIds = (salesOrders || []).map((so) => so.id)

  const { data: salesOrderItems } = salesOrderIds.length
    ? await supabase.from("sales_order_items").select("*").in("sales_order_id", salesOrderIds)
    : { data: [] }

  const productCodes = Array.from(
    new Set(
      (salesOrderItems || [])
        .map((item) => item.code ?? item.product_code)
        .filter((code): code is string => Boolean(code)),
    ),
  )

  const { data: products } = productCodes.length
    ? await supabase.from("products").select("*").in("code", productCodes)
    : { data: [] }

  const { data: customers } = customerCnos.length
    ? await supabase.from("customers").select("*").in("code", customerCnos)
    : { data: [] }

  const customerMap = new Map(
    (customers || []).flatMap((customer) => [
      [customer.code, customer] as const,
      [customer.cno || customer.code, customer] as const,
    ]),
  )
  const productMap = new Map((products || []).map((product) => [product.code, product]))

  const salesOrderItemsMap = (salesOrderItems || []).reduce((map, item) => {
    const productCode = item.code ?? item.product_code
    const current = map.get(item.sales_order_id) || []
    current.push({
      ...item,
      code: productCode ?? null,
      product: productCode ? productMap.get(productCode) : undefined,
    })
    map.set(item.sales_order_id, current)
    return map
  }, new Map<string, Array<Record<string, unknown>>>())

  const { data: arRows, error: arError } = await supabase
    .from("accounts_receivable")
    .select("*")
    .order("created_at", { ascending: false })

  if (arError) {
    console.error("Error fetching accounts_receivable:", arError)
  }

  const arMap = (arRows || []).reduce((map, row) => {
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

  // 不在頁面渲染階段自動寫入資料庫，避免因權限或約束造成錯誤
  // 缺少的應收資料以即時計算方式顯示，實際落地由操作流程（例如一鍵沖帳）或 SQL 腳本處理

  const enrichedRecords: AccountsReceivable[] = (salesOrders || []).map((so) => {
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

    return {
      id: existing?.id || `virtual-${so.id}`,
      sales_order_id: so.id,
      customer_cno: effectiveCustomerCno,
      amount_due: amountDue,
      paid_amount: paidAmount,
      paid_at: existing?.paid_at || (so.is_paid ? so.updated_at : null),
      due_date: existing?.due_date || so.order_date,
      status: so.is_paid ? "paid" : paidAmount > 0 ? "partially_paid" : "unpaid",
      notes: existing?.notes || so.notes || null,
      created_at: existing?.created_at || so.created_at,
      updated_at: existing?.updated_at || so.updated_at,
      sales_order: {
        ...so,
        items: (salesOrderItemsMap.get(so.id) || []) as AccountsReceivable["sales_order"] extends { items?: infer T } ? T : never,
      },
      customer: effectiveCustomerCno ? customerMap.get(effectiveCustomerCno) : undefined,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">應收帳款管理</h1>
        <p className="text-muted-foreground mt-2">管理銷貨應收帳款記錄</p>
      </div>

      {arError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-1">
          <p className="text-sm text-destructive font-semibold">`accounts_receivable` 讀取失敗，已改用銷貨資料即時計算</p>
          <p className="text-xs text-destructive/80">{arError.message}</p>
        </div>
      )}

      <ARTable records={enrichedRecords} />
    </div>
  )
}
