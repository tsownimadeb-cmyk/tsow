"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase/client"
import type { Supplier } from "@/lib/types"
import { formatCurrencyOneDecimal } from "@/lib/utils"

interface StatementRow {
  supplier_id: string
  supplier_name: string
  statement_day: number | null
  period_start: string
  period_end: string
  total_payable: number
}

interface ProductItem {
  code: string | null
  name: string
  quantity: number
}

interface OrderRow {
  id: string
  ap_id: string | null
  purchase_order_id: string
  order_no: string
  order_date: string
  products: ProductItem[]
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

    return [message, details, hint]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" | ") || "發生錯誤"
  }

  return "發生錯誤"
}

function formatProductNames(products: ProductItem[]) {
  if (products.length === 0) return "-"
  return products.map((product) => product.name).join("、")
}

export function SupplierStatementDetailPanel({ suppliers }: SupplierStatementDetailPanelProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [allTime, setAllTime] = useState(false)
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [supplierSearch, setSupplierSearch] = useState("")
  const [statement, setStatement] = useState<StatementRow | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId)
  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(supplierSearch.toLowerCase()),
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
        let currentStatement: StatementRow | null = null

        if (!allTime) {
          const [year, month] = yearMonth.split("-").map(Number)
          const { data: statementData, error: statementError } = await supabase.rpc(
            "supplier_statement_payable_period",
            { p_year: year, p_month: month },
          )

          if (statementError) throw statementError

          currentStatement =
            (statementData || []).find((row: StatementRow) => row.supplier_id === selectedSupplierId) || null
        }

        setStatement(currentStatement)

        let purchaseOrdersQuery = supabase
          .from("purchase_orders")
          .select(
            "id, order_no, order_date, total_amount, is_paid, notes, supplier_id, accounts_payable(id, amount_due, paid_amount, status)",
          )
          .eq("supplier_id", selectedSupplierId)

        if (!allTime && currentStatement) {
          purchaseOrdersQuery = purchaseOrdersQuery
            .gte("order_date", currentStatement.period_start)
            .lte("order_date", currentStatement.period_end)
        }

        const { data: purchaseOrders, error: purchaseOrdersError } = await purchaseOrdersQuery.order("order_date", {
          ascending: false,
        })
        if (purchaseOrdersError) throw purchaseOrdersError

        const purchaseOrderIds = (purchaseOrders || []).map((purchaseOrder) => purchaseOrder.id)
        const { data: itemData, error: itemError } = purchaseOrderIds.length
          ? await supabase
              .from("purchase_order_items")
              .select("purchase_order_id, code, quantity")
              .in("purchase_order_id", purchaseOrderIds)
          : { data: [], error: null }
        if (itemError) throw itemError

        const itemsByPurchaseOrderId = new Map<string, Array<{ code: string | null; quantity: number }>>()
        for (const item of itemData || []) {
          const currentItems = itemsByPurchaseOrderId.get(item.purchase_order_id) || []
          currentItems.push({ code: item.code ?? null, quantity: Number(item.quantity) || 0 })
          itemsByPurchaseOrderId.set(item.purchase_order_id, currentItems)
        }

        const productCodes = Array.from(new Set((itemData || []).map((item) => item.code).filter(Boolean))) as string[]
        const productNameByCode = new Map<string, string>()

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

        const nextOrders: OrderRow[] = (purchaseOrders || []).map((purchaseOrder: any) => {
          const ap = Array.isArray(purchaseOrder.accounts_payable)
            ? purchaseOrder.accounts_payable[0]
            : purchaseOrder.accounts_payable

          const amountDue = ap ? Number(ap.amount_due) : Number(purchaseOrder.total_amount)
          const paidAmount = ap
            ? Number(ap.paid_amount)
            : purchaseOrder.is_paid
              ? Number(purchaseOrder.total_amount)
              : 0

          const products: ProductItem[] = (itemsByPurchaseOrderId.get(purchaseOrder.id) || [])
            .map((item) => ({
              code: item.code,
              name: item.code ? productNameByCode.get(item.code) || item.code : "-",
              quantity: item.quantity,
            }))
            .filter((item) => item.name !== "-")

          return {
            id: ap?.id || `virtual-${purchaseOrder.id}`,
            ap_id: ap?.id || null,
            purchase_order_id: purchaseOrder.id,
            order_no: purchaseOrder.order_no,
            order_date: purchaseOrder.order_date,
            products,
            amount_due: amountDue,
            paid_amount: paidAmount,
            outstanding: amountDue - paidAmount,
            is_paid: purchaseOrder.is_paid,
            notes: purchaseOrder.notes,
            status: ap?.status || (purchaseOrder.is_paid ? "paid" : "unpaid"),
          }
        })

        setOrders(nextOrders)
      } catch (error) {
        toast({
          title: "查詢失敗",
          description: getErrorMessage(error),
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [allTime, selectedSupplierId, toast, yearMonth])

  const totalDue = orders.reduce((sum, order) => sum + order.amount_due, 0)
  const totalOutstanding = orders.reduce((sum, order) => sum + order.outstanding, 0)

  const buildCheckLinkedNote = (existing: string | null | undefined) => {
    const entry = `${AP_CHECK_LINKED_TAG}${new Date().toISOString()}`
    const base = (existing || "").trim()
    return base ? `${base}\n${entry}` : entry
  }

  const handleBatchSettle = () => {
    if (!selectedSupplier) return

    startTransition(async () => {
      try {
        const supabase = createClient()
        const unpaidOrders = orders.filter((order) => order.outstanding > 0)

        if (unpaidOrders.length === 0) {
          toast({ title: "提示", description: "目前沒有未付款單據" })
          return
        }

        const purchaseOrderIds = unpaidOrders.map((order) => order.purchase_order_id)
        const { error: purchaseOrdersError } = await supabase
          .from("purchase_orders")
          .update({ is_paid: true })
          .in("id", purchaseOrderIds)
        if (purchaseOrdersError) throw purchaseOrdersError

        for (const order of unpaidOrders) {
          if (order.id.startsWith("virtual-")) {
            const { error } = await supabase.from("accounts_payable").insert({
              purchase_order_id: order.purchase_order_id,
              supplier_id: selectedSupplierId,
              amount_due: order.amount_due,
              total_amount: order.amount_due,
              paid_amount: order.amount_due,
              due_date: order.order_date,
              status: "paid",
            })
            if (error) throw error
          } else {
            const { error } = await supabase
              .from("accounts_payable")
              .update({ paid_amount: order.amount_due, status: "paid", total_amount: order.amount_due })
              .eq("id", order.id)
            if (error) throw error
          }
        }

        toast({ title: "成功", description: `已完成 ${selectedSupplier.name} 的一鍵沖帳` })
        router.refresh()
        setSelectedSupplierId("")
      } catch (error) {
        toast({
          title: "錯誤",
          description: getErrorMessage(error),
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
        const unpaidOrders = orders.filter((order) => order.outstanding > 0)

        if (unpaidOrders.length === 0) {
          toast({ title: "提示", description: "目前沒有未付款單據" })
          return
        }

        for (const order of unpaidOrders) {
          if (order.id.startsWith("virtual-")) {
            const { error } = await supabase.from("accounts_payable").insert({
              purchase_order_id: order.purchase_order_id,
              supplier_id: selectedSupplierId,
              amount_due: order.amount_due,
              total_amount: order.amount_due,
              paid_amount: order.paid_amount,
              due_date: null,
              status: order.paid_amount > 0 ? "partially_paid" : "unpaid",
              notes: buildCheckLinkedNote(order.notes),
            })
            if (error) throw error
          } else {
            const { error } = await supabase
              .from("accounts_payable")
              .update({ notes: buildCheckLinkedNote(order.notes) })
              .eq("id", order.id)
            if (error) throw error
          }
        }

        const query = new URLSearchParams()
        query.set("supplierId", selectedSupplierId)
        query.set("purchaseOrderIds", unpaidOrders.map((order) => order.purchase_order_id).join(","))
        query.set("source", "ap")

        toast({ title: "成功", description: "已帶入支票付款資料" })
        router.push(`/accounts-payable/checks?${query.toString()}`)
      } catch (error) {
        toast({
          title: "錯誤",
          description: getErrorMessage(error),
          variant: "destructive",
        })
      }
    })
  }

  const handleExportStatement = () => {
    if (!selectedSupplier) return

    const unpaidOrders = orders.filter((order) => order.outstanding > 0)
    if (unpaidOrders.length === 0) {
      toast({ title: "提示", description: "目前沒有未付款資料可匯出" })
      return
    }

    const headers = ["供應商名稱", "進貨單號", "日期", "商品", "單筆金額", "已付金額", "未付金額"]
    const lines = unpaidOrders.map((order) =>
      [
        selectedSupplier.name,
        order.order_no,
        order.order_date ? new Date(order.order_date).toLocaleDateString("zh-TW") : "-",
        formatProductNames(order.products),
        order.amount_due,
        order.paid_amount,
        order.outstanding,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    )
    const totalLine = ["", "", "", "總金額", unpaidOrders.reduce((sum, order) => sum + order.amount_due, 0), "", ""]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
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
                className="w-full rounded border px-2 py-1 text-sm"
                placeholder="搜尋廠商..."
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
            </div>
            {filteredSuppliers.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">無符合廠商</div>
            ) : (
              filteredSuppliers.map((supplier) => (
                <DropdownMenuItem
                  key={supplier.id}
                  onSelect={() => {
                    setSelectedSupplierId(supplier.id)
                    setSupplierSearch("")
                  }}
                >
                  {supplier.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          type="month"
          value={yearMonth}
          onChange={(event) => {
            setYearMonth(event.target.value)
            setAllTime(false)
          }}
          className="rounded border px-3 py-2 text-sm"
          disabled={allTime}
        />

        <Button
          type="button"
          variant={allTime ? "default" : "outline"}
          size="sm"
          onClick={() => setAllTime((value) => !value)}
        >
          全部時間
        </Button>
      </div>

      {!selectedSupplierId && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          請先選擇廠商，再查詢月結應付帳款
        </div>
      )}

      {selectedSupplierId && loading && (
        <div className="py-8 text-center text-muted-foreground">載入中...</div>
      )}

      {selectedSupplierId && !loading && orders.length > 0 && (
        <div className="rounded-lg border">
          <div className="flex w-full items-center gap-2 border-b px-4 py-3">
            <div className="flex-1">
              <p className="font-medium">{selectedSupplier?.name}</p>
              <p className="text-xs text-muted-foreground">
                {orders.length} 筆單據・
                {allTime
                  ? "全部時間"
                  : statement
                    ? `結帳日：${statement.statement_day ? `每月 ${statement.statement_day} 號` : "月底"}・期間：${statement.period_start} ～ ${statement.period_end}`
                    : "無月結資料"}
              </p>
            </div>
            <div className="mr-4 text-right text-sm text-muted-foreground">
              應付合計 {formatCurrencyOneDecimal(totalDue)}
            </div>
            <div className="text-right text-base font-semibold text-destructive">
              總欠款 {formatCurrencyOneDecimal(totalOutstanding)}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-b px-4 py-2">
            <Button variant="outline" size="sm" onClick={handleExportStatement} disabled={isPending}>
              匯出對帳單
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={isPending}>
                  {isPending ? "處理中..." : "付款方式"}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleBatchSettle}>現金</DropdownMenuItem>
                <DropdownMenuItem onClick={handlePayByCheck}>支票</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>進貨單號</TableHead>
                <TableHead>日期</TableHead>
                <TableHead>商品</TableHead>
                <TableHead className="text-right">數量</TableHead>
                <TableHead className="text-right">單筆金額</TableHead>
                <TableHead className="text-right">未付金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const products = Array.isArray(order.products) ? order.products : []

                return (
                  <TableRow key={order.purchase_order_id}>
                    <TableCell className="font-medium">{order.order_no}</TableCell>
                    <TableCell>
                      {order.order_date ? new Date(order.order_date).toLocaleDateString("zh-TW") : "-"}
                    </TableCell>
                    <TableCell>
                      {products.length === 0 ? (
                        "-"
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {products.map((product, index) => (
                            <span key={`${order.purchase_order_id}-name-${index}`}>{product.name}</span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {products.length === 0 ? (
                        "-"
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {products.map((product, index) => (
                            <span key={`${order.purchase_order_id}-qty-${index}`}>{product.quantity}</span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(order.amount_due)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(order.outstanding)}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow className="bg-muted/40">
                <TableCell colSpan={4} className="text-right font-semibold">
                  總金額
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatCurrencyOneDecimal(totalDue)}
                </TableCell>
                <TableCell className="text-right font-semibold text-destructive">
                  {formatCurrencyOneDecimal(totalOutstanding)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {selectedSupplierId && !loading && orders.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          {allTime ? `查無 ${selectedSupplier?.name} 的歷史進貨資料` : `查無 ${selectedSupplier?.name} 在 ${yearMonth} 的月結資料`}
        </div>
      )}
    </div>
  )
}
