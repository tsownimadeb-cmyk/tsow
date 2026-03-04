import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { APChecksTable, type APCheckRecord } from "@/components/accounts-payable/ap-checks-table"

export const metadata: Metadata = {
  title: "應付支票管理",
  description: "管理應付帳款支票",
}

export default async function AccountsPayableChecksPage() {
  const supabase = await createClient()
  const AP_CHECK_LINKED_TAG = "[AP_CHECK_LINKED]"
  const AP_CHECK_STATUS_TAG = "[AP_CHECK_STATUS]"

  const { data: payableRows, error: payableError } = await supabase
    .from("accounts_payable")
    .select("*")
    .order("created_at", { ascending: false })

  if (payableError) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">應付支票管理</h1>
          <p className="text-muted-foreground mt-2">管理應付帳款支票資料</p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <p className="text-destructive font-semibold">無法載入應付支票資料</p>
          <p className="text-sm text-destructive/80">{payableError.message}</p>
        </div>
      </div>
    )
  }

  const chequeRows = (payableRows || []).filter((row) => {
    if (!row.purchase_order_id) return false

    const checkNo = (row as { check_no?: string | null }).check_no
    const checkBank = (row as { check_bank?: string | null }).check_bank
    const checkIssueDate = (row as { check_issue_date?: string | null }).check_issue_date
    const notes = (row.notes || "") as string

    return Boolean(
      checkNo ||
      checkBank ||
      checkIssueDate ||
      notes.includes(AP_CHECK_LINKED_TAG) ||
      notes.includes(AP_CHECK_STATUS_TAG),
    )
  })

  const purchaseOrderIds = chequeRows
    .map((row) => row.purchase_order_id)
    .filter((id): id is string => Boolean(id))

  const supplierIds = Array.from(
    new Set(chequeRows.map((row) => row.supplier_id).filter((id): id is string => Boolean(id))),
  )

  const [{ data: suppliers }, { data: purchaseOrders }] = await Promise.all([
    supplierIds.length
      ? supabase.from("suppliers").select("id,name").in("id", supplierIds)
      : Promise.resolve({ data: [] }),
    purchaseOrderIds.length
      ? supabase
          .from("purchase_orders")
          .select("id,order_no,supplier_id,order_date,total_amount,is_paid,notes,created_at,updated_at")
          .in("id", purchaseOrderIds)
      : Promise.resolve({ data: [] }),
  ])

  const supplierMap = new Map((suppliers || []).map((supplier) => [supplier.id, supplier.name]))
  const purchaseOrderMap = new Map((purchaseOrders || []).map((po) => [po.id, po]))

  const records: APCheckRecord[] = chequeRows.map((payable) => {
    const purchaseOrder = payable.purchase_order_id ? purchaseOrderMap.get(payable.purchase_order_id) : undefined
    const amountDue = Number(payable?.amount_due ?? payable?.total_amount ?? purchaseOrder?.total_amount ?? 0) || 0
    const paidAmount = Number(payable?.paid_amount ?? (purchaseOrder?.is_paid ? purchaseOrder.total_amount : 0) ?? 0) || 0
    const checkNo = (payable as { check_no?: string | null } | undefined)?.check_no ?? null
    const checkBank = (payable as { check_bank?: string | null } | undefined)?.check_bank ?? null
    const checkIssueDate = (payable as { check_issue_date?: string | null } | undefined)?.check_issue_date ?? null
    const rawDueDate = payable?.due_date ?? null
    const dueDate =
      rawDueDate && rawDueDate === purchaseOrder?.order_date && !checkNo && !checkBank && !checkIssueDate
        ? null
        : rawDueDate

    return {
      id: payable.id,
      purchaseOrderId: payable.purchase_order_id,
      orderNo: purchaseOrder?.order_no || "-",
      orderDate: purchaseOrder?.order_date ?? null,
      supplierId: payable?.supplier_id ?? purchaseOrder?.supplier_id ?? null,
      supplierName:
        (payable?.supplier_id ? supplierMap.get(payable.supplier_id) : undefined) ||
        (purchaseOrder?.supplier_id ? supplierMap.get(purchaseOrder.supplier_id) : undefined) ||
        "未指定供應商",
      amountDue,
      paidAmount,
      checkNo,
      checkBank,
      checkIssueDate,
      dueDate,
      paidAt: payable?.paid_at ?? null,
      status: payable?.status ?? (purchaseOrder?.is_paid ? "paid" : "unpaid"),
      notes: payable?.notes ?? purchaseOrder?.notes ?? null,
      createdAt: payable?.created_at ?? purchaseOrder?.created_at,
      updatedAt: payable?.updated_at ?? purchaseOrder?.updated_at,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">應付支票管理</h1>
        <p className="text-muted-foreground mt-2">管理應付帳款支票資料</p>
      </div>
      <APChecksTable records={records} />
    </div>
  )
}
