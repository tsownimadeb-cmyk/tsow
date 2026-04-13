import type { Metadata } from "next"
import { createClient } from "@/lib/supabase/server"
import { ARHistoryTable } from "../../../components/accounts-receivable/ar-history-table"

export const metadata: Metadata = {
  title: "收款履歷",
  description: "應收帳款收款履歷紀錄",
}

export const dynamic = "force-dynamic"

interface ReceiptRecord {
  id: string
  ar_id: string | null
  sales_order_id: string | null
  payment_date: string | null
  customer_name: string | null
  customer_cno: string | null
  order_no: string | null
  payment_method: string | null
  check_no: string | null
  check_due_date: string | null
  payment_amount: number | null
  notes: string | null
  created_at: string | null
}

const INTERNAL_NOTE_PREFIXES = ["[AR_PAYMENT]", "[AR_CHECK_LINKED]", "[AR_CHECK_STATUS]", "[PARTIAL_SETTLEMENT]"]

const formatReceiptNotes = (notes: string | null) => {
  const visibleLines = String(notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_NOTE_PREFIXES.some((prefix) => line.startsWith(prefix)))

  return visibleLines.length > 0 ? visibleLines.join("\n") : "-"
}

export default async function ARHistoryPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("ar_receipts")
    .select("id,ar_id,sales_order_id,payment_date,customer_name,customer_cno,order_no,payment_method,check_no,check_due_date,payment_amount,notes,created_at")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })

  const records = (data || []) as ReceiptRecord[]

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">收款履歷</h1>
        <p className="text-sm text-muted-foreground mt-1">每次沖帳成功後，會在此自動留下收款紀錄。</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-1">
          <p className="text-sm font-semibold text-destructive">無法讀取 `ar_receipts`</p>
          <p className="text-xs text-destructive/80">{error.message}</p>
          <p className="text-xs text-destructive/80">請先在 Supabase 執行 `scripts/031-create-ar-receipts.sql`。</p>
        </div>
      )}

      {!error && records.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          目前尚無收款履歷資料，請先執行一次沖帳。
        </div>
      ) : (
        <ARHistoryTable initialRecords={records} />
      )}
    </div>
  )
}
