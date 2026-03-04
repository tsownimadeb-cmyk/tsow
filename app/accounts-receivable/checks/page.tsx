import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { ARChecksTable, type ARCheckRecord } from "../../../components/accounts-receivable/ar-checks-table"

export const metadata: Metadata = {
  title: "應收支票管理",
  description: "管理應收帳款支票",
}

export default async function AccountsReceivableChecksPage() {
  const supabase = await createClient()
  const AR_CHECK_LINKED_TAG = "[AR_CHECK_LINKED]"
  const AR_CHECK_STATUS_TAG = "[AR_CHECK_STATUS]"

  const { data: receivableRows, error: receivableError } = await supabase
    .from("accounts_receivable")
    .select("*")
    .order("created_at", { ascending: false })

  if (receivableError) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">應收支票管理</h1>
          <p className="text-muted-foreground mt-2">管理應收帳款支票資料</p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <p className="text-destructive font-semibold">無法載入應收支票資料</p>
          <p className="text-sm text-destructive/80">{receivableError.message}</p>
        </div>
      </div>
    )
  }

  const chequeRows = (receivableRows || []).filter((row) => {
    if (!row.sales_order_id) return false

    const checkNo = (row as { check_no?: string | null }).check_no
    const checkBank = (row as { check_bank?: string | null }).check_bank
    const checkIssueDate = (row as { check_issue_date?: string | null }).check_issue_date
    const notes = (row.notes || "") as string

    return Boolean(
      checkNo ||
      checkBank ||
      checkIssueDate ||
      notes.includes(AR_CHECK_LINKED_TAG) ||
      notes.includes(AR_CHECK_STATUS_TAG),
    )
  })

  const salesOrderIds = chequeRows
    .map((row) => row.sales_order_id)
    .filter((id): id is string => Boolean(id))

  const customerCnos = Array.from(
    new Set(chequeRows.map((row) => row.customer_cno).filter((cno): cno is string => Boolean(cno))),
  )

  const [{ data: customers }, { data: salesOrders }] = await Promise.all([
    customerCnos.length
      ? supabase.from("customers").select("code,name").in("code", customerCnos)
      : Promise.resolve({ data: [] }),
    salesOrderIds.length
      ? supabase
          .from("sales_orders")
          .select("id,order_no,customer_cno,order_date,total_amount,is_paid,notes,created_at,updated_at")
          .in("id", salesOrderIds)
      : Promise.resolve({ data: [] }),
  ])

  const customerMap = new Map((customers || []).map((customer) => [customer.code, customer.name]))
  const salesOrderMap = new Map((salesOrders || []).map((so) => [so.id, so]))

  const records: ARCheckRecord[] = chequeRows.map((receivable) => {
    const salesOrder = receivable.sales_order_id ? salesOrderMap.get(receivable.sales_order_id) : undefined
    const amountDue = Number(receivable?.amount_due ?? receivable?.total_amount ?? salesOrder?.total_amount ?? 0) || 0
    const paidAmount = Number(receivable?.paid_amount ?? (salesOrder?.is_paid ? salesOrder.total_amount : 0) ?? 0) || 0
    const checkNo = (receivable as { check_no?: string | null } | undefined)?.check_no ?? null
    const checkBank = (receivable as { check_bank?: string | null } | undefined)?.check_bank ?? null
    const checkIssueDate = (receivable as { check_issue_date?: string | null } | undefined)?.check_issue_date ?? null
    const rawDueDate = receivable?.due_date ?? null
    const dueDate =
      rawDueDate && rawDueDate === salesOrder?.order_date && !checkNo && !checkBank && !checkIssueDate
        ? null
        : rawDueDate

    return {
      id: receivable.id,
      salesOrderId: receivable.sales_order_id,
      orderNo: salesOrder?.order_no || "-",
      orderDate: salesOrder?.order_date ?? null,
      customerCno: receivable?.customer_cno ?? salesOrder?.customer_cno ?? null,
      customerName:
        (receivable?.customer_cno ? customerMap.get(receivable.customer_cno) : undefined) ||
        (salesOrder?.customer_cno ? customerMap.get(salesOrder.customer_cno) : undefined) ||
        "未指定客戶",
      amountDue,
      paidAmount,
      checkNo,
      checkBank,
      checkIssueDate,
      dueDate,
      paidAt: receivable?.paid_at ?? null,
      status: receivable?.status ?? (salesOrder?.is_paid ? "paid" : "unpaid"),
      notes: receivable?.notes ?? salesOrder?.notes ?? null,
      createdAt: receivable?.created_at ?? salesOrder?.created_at,
      updatedAt: receivable?.updated_at ?? salesOrder?.updated_at,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">應收支票管理</h1>
        <p className="text-muted-foreground mt-2">管理應收帳款支票資料</p>
      </div>
      <ARChecksTable records={records} />
    </div>
  )
}
