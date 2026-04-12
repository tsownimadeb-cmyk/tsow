"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Eye, EyeOff } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { Supplier } from "@/lib/types"

interface StatementRow {
  supplier_id: string
  supplier_name: string
  statement_day: number | null
  period_start: string
  period_end: string
  total_payable: number
}

interface OrderRow {
  id: string
  ap_id: string | null
  purchase_order_id: string
  order_no: string
  order_date: string
  products: string
  amount_due: number
  paid_amount: number
  outstanding: number
  is_paid: boolean
  notes: string | null
  status: string
}

const AP_CHECK_LINKED_TAG = "[AP_CHECK_LINKED]"

interface SupplierStatementDetailPanelProps {
  suppliers: Supplier[]
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    const message = "message" in error ? error.message : undefined
    const details = "details" in error ? error.details : undefined
    const hint = "hint" in error ? error.hint : undefined

    return [message, details, hint].filter((value) => typeof value === "string" && value.length > 0).join(" | ") || "發生錯誤"
  }

  return "發生錯誤"
}

export function SupplierStatementDetailPanel({ suppliers }: SupplierStatementDetailPanelProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("")
  const [supplierSearch, setSupplierSearch] = useState("")
  const [statement, setStatement] = useState<StatementRow | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [isPrivacyMode, setIsPrivacyMode] = useState(true)
  const [isPending, startTransition] = useTransition()

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId)
  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()),
  )

  useEffect(() => {
    if (!selectedSupplierId) {
      setStatement(null)
      setOrders([])
      return
    }
    const fetchData = async () => {
      setLoading(true)
      try {
        const supabase = createClient()
        const [year, month] = yearMonth.split("-").map(Number)

        const { data: stmtData, error: stmtError } = await supabase.rpc(
          "supplier_statement_payable_period",
          { p_year: year, p_month: month },
        )
        if (stmtError) throw stmtError
        const row = (stmtData || []).find((r: StatementRow) => r.supplier_id === selectedSupplierId)
        setStatement(row || null)

        if (row) {
          const productNameByCode = new Map<string, string>()

          const { data: poData, error: poError } = await supabase
            .from("purchase_orders")
            .select("id, order_no, order_date, total_amount, is_paid, notes, supplier_id, accounts_payable(id, amount_due, paid_amount, status)")
            .eq("supplier_id", selectedSupplierId)
            .gte("order_date", row.period_start)
            .lte("order_date", row.period_end)
            .order("order_date", { ascending: false })
          if (poError) throw poError

          const purchaseOrderIds = (poData || []).map((po) => po.id)
          const { data: itemData, error: itemError } = purchaseOrderIds.length
            ? await supabase
                .from("purchase_order_items")
                .select("purchase_order_id, code")
                .in("purchase_order_id", purchaseOrderIds)
            : { data: [], error: null }
          if (itemError) throw itemError

          const itemsByPurchaseOrderId = new Map<string, Array<{ code: string | null }>>()
          for (const item of itemData || []) {
            const currentItems = itemsByPurchaseOrderId.get(item.purchase_order_id) || []
            currentItems.push({ code: item.code ?? null })
            itemsByPurchaseOrderId.set(item.purchase_order_id, currentItems)
          }

          const productCodes = Array.from(
            new Set((itemData || []).map((item) => item.code).filter((code): code is string => Boolean(code))),
          )
          if (productCodes.length > 0) {
            const { data: productData, error: productError } = await supabase
              .from("products")
              .select("code, name")
              .in("code", productCodes)
            if (productError) throw productError

            for (const product of productData || []) {
              productNameByCode.set(product.code, product.name)
            }
          }

          const flat: OrderRow[] = (poData || []).map((po: any) => {
            const ap = Array.isArray(po.accounts_payable) ? po.accounts_payable[0] : po.accounts_payable
            const amount_due = ap ? Number(ap.amount_due) : Number(po.total_amount)
            const paid_amount = ap ? Number(ap.paid_amount) : (po.is_paid ? Number(po.total_amount) : 0)
            const products = (itemsByPurchaseOrderId.get(po.id) || [])
              .map((item) => (item.code ? productNameByCode.get(item.code) || item.code : "-"))
              .filter(Boolean)
              .join("、") || "-"
            return {
              id: ap?.id || `virtual-${po.id}`,
              ap_id: ap?.id || null,
              purchase_order_id: po.id,
              order_no: po.order_no,
              order_date: po.order_date,
              products,
              amount_due,
              paid_amount,
              outstanding: amount_due - paid_amount,
              is_paid: po.is_paid,
              notes: po.notes,
              status: ap?.status || (po.is_paid ? "paid" : "unpaid"),
            }
          })
          setOrders(flat)
        }
      } catch (err) {
        toast({
          title: "查詢失敗",
          description: getErrorMessage(err),
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [selectedSupplierId, yearMonth])

  const renderAmount = (value: number) => {
    if (isPrivacyMode) return <span className="text-muted-foreground tracking-widest">****</span>
    return formatCurrencyOneDecimal(value)
  }

  const totalDue = orders.reduce((s, o) => s + o.amount_due, 0)
  const totalOutstanding = orders.reduce((s, o) => s + o.outstanding, 0)

  const buildCheckLinkedNote = (existing: string | null | undefined) => {
    const ts = new Date().toISOString()
    const entry = `${AP_CHECK_LINKED_TAG}${ts}`
    const base = (existing || "").trim()
    return base ? `${base}\n${entry}` : entry
  }

  const handleBatchSettle = () => {
    if (!selectedSupplier) return
    startTransition(async () => {
      try {
        const supabase = createClient()
        const unpaid = orders.filter((o) => o.outstanding > 0)
        if (unpaid.length === 0) {
          toast({ title: "提示", description: "目前沒有未付款單據" })
          return
        }
        const poIds = unpaid.map((o) => o.purchase_order_id).filter(Boolean)
        if (poIds.length > 0) {
          const { error } = await supabase.from("purchase_orders").update({ is_paid: true }).in("id", poIds)
          if (error) throw error
        }
        for (const o of unpaid) {
          if (o.id.startsWith("virtual-")) {
            await supabase.from("accounts_payable").insert({
              purchase_order_id: o.purchase_order_id,
              supplier_id: selectedSupplierId,
              amount_due: o.amount_due,
              total_amount: o.amount_due,
              paid_amount: o.amount_due,
              due_date: o.order_date,
              status: "paid",
            })
          } else {
            await supabase
              .from("accounts_payable")
              .update({ paid_amount: o.amount_due, status: "paid", total_amount: o.amount_due })
              .eq("id", o.id)
          }
        }
        toast({ title: "成功", description: `已完成 ${selectedSupplier.name} 的一鍵沖帳` })
        router.refresh()
        setSelectedSupplierId("")
      } catch (err) {
        toast({
          title: "錯誤",
          description: err instanceof Error ? err.message : "發生錯誤",
          variant: "destructive",
        })
      }
    })
  }

  const handlePayByCheck = () => {
    if (!selectedSupplier) return
    startTransition(async () => {
      try {
        const supabase = createClient()
        const unpaid = orders.filter((o) => o.outstanding > 0)
        if (unpaid.length === 0) {
          toast({ title: "提示", description: "目前沒有未付款單據" })
          return
        }
        for (const o of unpaid) {
          if (o.id.startsWith("virtual-")) {
            await supabase.from("accounts_payable").insert({
              purchase_order_id: o.purchase_order_id,
              supplier_id: selectedSupplierId,
              amount_due: o.amount_due,
              total_amount: o.amount_due,
              paid_amount: o.paid_amount,
              due_date: null,
              status: o.paid_amount > 0 ? "partially_paid" : "unpaid",
              notes: buildCheckLinkedNote(o.notes),
            })
          } else {
            await supabase
              .from("accounts_payable")
              .update({ notes: buildCheckLinkedNote(o.notes) })
              .eq("id", o.id)
          }
        }
        const orderIdsParam = unpaid
          .map((o) => o.purchase_order_id)
          .filter(Boolean)
          .join(",")
        const query = new URLSearchParams()
        query.set("supplierId", selectedSupplierId)
        if (orderIdsParam) query.set("purchaseOrderIds", orderIdsParam)
        query.set("source", "ap")
        toast({ title: "成功", description: "已帶入支票付款資料" })
        router.push(`/accounts-payable/checks?${query.toString()}`)
      } catch (err) {
        toast({
          title: "錯誤",
          description: err instanceof Error ? err.message : "發生錯誤",
          variant: "destructive",
        })
      }
    })
  }

  const handleExportStatement = () => {
    if (!selectedSupplier) return
    const unpaid = orders.filter((o) => o.outstanding > 0)
    if (unpaid.length === 0) {
      toast({ title: "提示", description: "目前沒有未付款資料可匯出" })
      return
    }
    const headers = ["供應商名稱", "進貨單號", "日期", "商品", "單筆金額", "已付金額", "未付金額"]
    const lines = unpaid.map((o) =>
      [
        selectedSupplier.name,
        o.order_no,
        o.order_date ? new Date(o.order_date).toLocaleDateString("zh-TW") : "-",
        o.products,
        o.amount_due,
        o.paid_amount,
        o.outstanding,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    )
    const totalLine = ["", "", "", "總金額", unpaid.reduce((s, o) => s + o.amount_due, 0), "", ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
    const csv = `\uFEFF${headers.join(",")}\n${lines.join("\n")}\n${totalLine}`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${selectedSupplier.name}-對帳單-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast({ title: "成功", description: "已匯出對帳單" })
  }

  return (
    <div className="space-y-4">
      {/* 選擇廠商 + 月份 + 隱私切換 */}
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-60 justify-between">
              {selectedSupplier ? selectedSupplier.name : "選擇廠商..."}
              <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60 max-h-80 overflow-y-auto">
            <div className="p-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="搜尋廠商..."
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {filteredSuppliers.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">無符合廠商</div>
            ) : (
              filteredSuppliers.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onSelect={() => {
                    setSelectedSupplierId(s.id)
                    setSupplierSearch("")
                  }}
                >
                  {s.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsPrivacyMode((v) => !v)}
          title={isPrivacyMode ? "顯示金額" : "隱藏金額"}
        >
          {isPrivacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {/* 空狀態 */}
      {!selectedSupplierId && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          請先選擇廠商，再查詢月結應付帳款
        </div>
      )}

      {/* 載入中 */}
      {selectedSupplierId && loading && (
        <div className="text-center py-8 text-muted-foreground">載入中...</div>
      )}

      {/* 明細卡片 */}
      {selectedSupplierId && !loading && statement && (
        <div className="rounded-lg border">
          {/* 標題列 */}
          <div className="flex w-full items-center gap-2 px-4 py-3 border-b">
            <div className="flex-1">
              <p className="font-medium">{selectedSupplier?.name}</p>
              <p className="text-xs text-muted-foreground">
                {orders.length} 筆單據・結帳日：
                {statement.statement_day ? `每月 ${statement.statement_day} 號` : "月底"}・期間：
                {statement.period_start} ～ {statement.period_end}
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground mr-4">
              應付合計 {renderAmount(totalDue)}
            </div>
            <div className="text-right text-base font-semibold text-destructive">
              總欠款 {renderAmount(totalOutstanding)}
            </div>
          </div>

          {/* 操作按鈕列 */}
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-b">
            <Button variant="outline" size="sm" onClick={handleExportStatement} disabled={isPending}>
              匯出對帳單
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={isPending}>
                  {isPending ? "處理中..." : "付款方式"}
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleBatchSettle}>現金</DropdownMenuItem>
                <DropdownMenuItem onClick={handlePayByCheck}>支票</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 明細表格 */}
          {orders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">本期無單據</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>進貨單號</TableHead>
                  <TableHead>日期</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead className="text-right">單筆金額</TableHead>
                  <TableHead className="text-right">未付金額</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.purchase_order_id}>
                    <TableCell className="font-medium">{o.order_no}</TableCell>
                    <TableCell>
                      {o.order_date ? new Date(o.order_date).toLocaleDateString("zh-TW") : "-"}
                    </TableCell>
                    <TableCell>{o.products}</TableCell>
                    <TableCell className="text-right">{renderAmount(o.amount_due)}</TableCell>
                    <TableCell className="text-right">{renderAmount(o.outstanding)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40">
                  <TableCell colSpan={3} className="text-right font-semibold">
                    總金額
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {renderAmount(totalDue)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-destructive">
                    {renderAmount(totalOutstanding)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* 無資料 */}
      {selectedSupplierId && !loading && !statement && (
        <div className="text-center py-8 text-muted-foreground">
          查無 {selectedSupplier?.name} 在 {yearMonth} 的月結資料
        </div>
      )}
    </div>
  )
}
