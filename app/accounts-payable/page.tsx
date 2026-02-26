import { createClient } from "@/lib/supabase/server"
import { APTable } from "../../components/accounts-payable/ap-table"
import type { AccountsPayable } from "@/lib/types"

export const metadata = {
  title: "應付帳款管理",
  description: "管理應付帳款記錄",
}

export default async function APPage() {
  const supabase = await createClient()

  const { data: purchaseOrders, error: purchaseError } = await supabase
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })

  if (purchaseError) {
    console.error("Error fetching purchase orders:", purchaseError)
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">應付帳款管理</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
          <p className="text-destructive font-semibold">無法載入進貨資料</p>
          <p className="text-sm text-destructive/80">{purchaseError.message}</p>
        </div>
      </div>
    )
  }

  const purchaseOrderIds = (purchaseOrders || []).map((po) => po.id)
  const supplierIds = Array.from(
    new Set((purchaseOrders || []).map((po) => po.supplier_id).filter((id): id is string => Boolean(id))),
  )

  const { data: purchaseOrderItems } = purchaseOrderIds.length
    ? await supabase.from("purchase_order_items").select("*").in("purchase_order_id", purchaseOrderIds)
    : { data: [] }

  const productCodes = Array.from(
    new Set(
      (purchaseOrderItems || [])
        .map((item) => item.product_code)
        .filter((code): code is string => Boolean(code)),
    ),
  )

  const [{ data: suppliers }, { data: products }] = await Promise.all([
    supplierIds.length > 0
      ? supabase.from("suppliers").select("*").in("id", supplierIds)
      : Promise.resolve({ data: [] }),
    productCodes.length > 0
      ? supabase.from("products").select("*").in("code", productCodes)
      : Promise.resolve({ data: [] }),
  ])

  const supplierMap = new Map((suppliers || []).map((supplier) => [supplier.id, supplier]))
  const productMap = new Map((products || []).map((product) => [product.code, product]))

  const purchaseOrderItemsMap = (purchaseOrderItems || []).reduce((map, item) => {
    const current = map.get(item.purchase_order_id) || []
    current.push({
      ...item,
      product: item.product_code ? productMap.get(item.product_code) : undefined,
    })
    map.set(item.purchase_order_id, current)
    return map
  }, new Map<string, Array<Record<string, unknown>>>())

  const { data: apRows, error: apError } = await supabase
    .from("accounts_payable")
    .select("*")
    .order("created_at", { ascending: false })

  if (apError) {
    console.error("Error fetching accounts_payable:", apError)
  }

  const apMap = new Map((apRows || []).map((row) => [row.purchase_order_id, row]))

  const enrichedRecords: AccountsPayable[] = (purchaseOrders || []).map((po) => {
    const existing = apMap.get(po.id)
    const existingAmountDue = existing
      ? Number(existing.amount_due ?? existing.total_amount ?? po.total_amount)
      : Number(po.total_amount)
    const amountDue = Number.isNaN(existingAmountDue) ? Number(po.total_amount) : existingAmountDue
    const existingPaidAmount = existing
      ? Number(existing.paid_amount ?? (po.is_paid ? po.total_amount : 0))
      : po.is_paid
        ? Number(po.total_amount)
        : 0
    const paidAmount = Number.isNaN(existingPaidAmount)
      ? po.is_paid
        ? Number(po.total_amount)
        : 0
      : existingPaidAmount

    return {
      id: existing?.id || `virtual-${po.id}`,
      purchase_order_id: po.id,
      supplier_id: po.supplier_id,
      amount_due: amountDue,
      total_amount: existing?.total_amount ?? Number(po.total_amount),
      paid_amount: paidAmount,
      due_date: existing?.due_date || po.order_date,
      status: existing?.status || (po.is_paid ? "paid" : "unpaid"),
      notes: existing?.notes || po.notes || null,
      created_at: existing?.created_at || po.created_at,
      updated_at: existing?.updated_at || po.updated_at,
      purchase_order: {
        ...po,
        items: (purchaseOrderItemsMap.get(po.id) || []) as AccountsPayable["purchase_order"] extends {
          items?: infer T
        }
          ? T
          : never,
      },
      supplier: po.supplier_id ? supplierMap.get(po.supplier_id) : undefined,
    }
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">應付帳款管理</h1>
        <p className="text-muted-foreground mt-2">管理進貨應付帳款記錄</p>
      </div>

      {apError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-1">
          <p className="text-sm text-destructive font-semibold">`accounts_payable` 讀取失敗，已改用進貨資料即時計算</p>
          <p className="text-xs text-destructive/80">{apError.message}</p>
        </div>
      )}

      <APTable records={enrichedRecords} />
    </div>
  )
}
