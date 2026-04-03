import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { APChecksTable, type APCheckRecord } from "@/components/accounts-payable/ap-checks-table"
import Link from "next/link"
import { applyServerStatusFilter, parseChecksListParams } from "@/lib/checks-query"

export const metadata: Metadata = {
  title: "應付支票管理",
  description: "管理應付帳款支票",
}

export const dynamic = "force-dynamic"

export default async function AccountsPayableChecksPage(props: any) {
  const searchParams = await props.searchParams
  const PAGE_SIZE = 20
  const { page, searchText, statusText, from, to } = parseChecksListParams(searchParams, PAGE_SIZE)

  const supabase = await createClient()
  const AP_CHECK_LINKED_TAG = "[AP_CHECK_LINKED]"
  const AP_CHECK_STATUS_TAG = "[AP_CHECK_STATUS]"
  const checksFilter = `check_no.not.is.null,check_bank.not.is.null,check_issue_date.not.is.null,notes.ilike.%${AP_CHECK_LINKED_TAG}%,notes.ilike.%${AP_CHECK_STATUS_TAG}%`

  let payableQuery = supabase
    .from("accounts_payable")
    .select("id,purchase_order_id,supplier_id,amount_due,total_amount,paid_amount,check_no,check_bank,check_issue_date,due_date,paid_at,status,notes,created_at,updated_at", { count: "exact" })
    .or(checksFilter)
    .order("created_at", { ascending: false })

  if (searchText && searchText.trim() !== "") {
    const keyword = searchText.trim()
    payableQuery = payableQuery.or(`check_no.ilike.%${keyword}%,check_bank.ilike.%${keyword}%,supplier_id.ilike.%${keyword}%,notes.ilike.%${keyword}%`)
  }

  payableQuery = applyServerStatusFilter(payableQuery, statusText, AP_CHECK_STATUS_TAG)

  const { data: payableRows, error: payableError, count: payableCount } = await payableQuery.range(from, to)

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

  const total = payableCount ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

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

  function getPageUrl(targetPage: number) {
    const params = new URLSearchParams()
    if (searchText) params.set("search", searchText)
    if (statusText && statusText !== "all") params.set("status", statusText)
    params.set("page", String(targetPage))
    return `/accounts-payable/checks?${params.toString()}`
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">應付支票管理</h1>
        <p className="text-muted-foreground mt-2">管理應付帳款支票資料（每頁 {PAGE_SIZE} 筆）</p>
      </div>
      <APChecksTable records={records} initialSearch={searchText} />
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
        <form method="get" action="/accounts-payable/checks" className="flex items-center gap-2">
          {searchText && <input type="hidden" name="search" value={searchText} />}
          {statusText && statusText !== "all" && <input type="hidden" name="status" value={statusText} />}
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
}
