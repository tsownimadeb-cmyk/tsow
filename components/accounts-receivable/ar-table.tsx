"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown, Eye, EyeOff, Search } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { AccountsReceivable } from "@/lib/types"

interface ARTableProps {
  records: AccountsReceivable[]
  allCustomers?: Array<{
    code: string
    name: string
  }>
}

const AR_CHECK_LINKED_TAG = "[AR_CHECK_LINKED]"

export function ARTable({ records, allCustomers = [] }: ARTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [isPrivacyMode, setIsPrivacyMode] = useState(true)
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isRowActionPending, startRowActionTransition] = useTransition()
  const [processingCustomerKey, setProcessingCustomerKey] = useState<string | null>(null)
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null)
  const [partialSettleTarget, setPartialSettleTarget] = useState<{
    customerCno: string
    customerName: string
    totalOutstanding: number
    orders: Array<{
      salesOrderId: string | null
      customerCno: string | null
      orderNumber: string
      orderDate: string | null
      amountDue: number
      paidAmount: number
      overpaidAmount: number
      outstanding: number
      notes: string | null
    }>
  } | null>(null)
  const [partialPaymentAmount, setPartialPaymentAmount] = useState("")
  const [restoreTargetOrder, setRestoreTargetOrder] = useState<{
    id: string
    salesOrderId: string | null
    customerCno: string | null
    orderNumber: string
    orderDate: string | null
    amountDue: number
  } | null>(null)

  const filteredRecords = records.filter(
    (record) =>
      record.customer_cno?.toLowerCase().includes(search.toLowerCase()) ||
      record.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
      record.sales_order?.order_no?.toLowerCase().includes(search.toLowerCase()),
  )

  const totalAmount = filteredRecords.reduce((sum, record) => sum + record.amount_due, 0)
  const paidAmount = filteredRecords.reduce((sum, record) => sum + record.paid_amount, 0)
  const overpaidAmount = filteredRecords.reduce((sum, record) => sum + Math.max(0, Number(record.overpaid_amount ?? 0) || 0), 0)
  const outstandingAmount = totalAmount - paidAmount

  const renderAmount = (value: number) => {
    if (isPrivacyMode) {
      return <span className="text-muted-foreground tracking-widest">****</span>
    }

    return formatCurrencyOneDecimal(value)
  }

  const buildPartialSettlementNote = (existingNotes: string | null | undefined, settledAt: string, amount: number) => {
    const sanitizedAmount = Math.max(0, Number(amount) || 0)
    const entry = `[PARTIAL_SETTLEMENT]${settledAt}|${sanitizedAmount}`
    const base = (existingNotes || "").trim()
    return base ? `${base}\n${entry}` : entry
  }

  const buildCheckLinkedNote = (existingNotes: string | null | undefined) => {
    const timestamp = new Date().toISOString()
    const entry = `${AR_CHECK_LINKED_TAG}${timestamp}`
    const base = (existingNotes || "").trim()
    return base ? `${base}\n${entry}` : entry
  }

  const parsePartialSettlementNotes = (notes: string | null | undefined) => {
    if (!notes) return [] as Array<{ at: string; amount: number }>

    return notes
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[PARTIAL_SETTLEMENT]"))
      .map((line) => {
        const raw = line.replace("[PARTIAL_SETTLEMENT]", "")
        const [at, amountText] = raw.split("|")
        return {
          at: at || "",
          amount: Math.max(0, Number(amountText || 0) || 0),
        }
      })
      .filter((entry) => Boolean(entry.at) && entry.amount > 0)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }

  const customerSummaryMap = allCustomers.reduce((map, customer) => {
    const customerCno = customer.code || "未指定"
    const customerName = customer.name || "散客"
    const key = `${customerCno}-${customerName}`

    if (!map.has(key)) {
      map.set(key, {
        customerName,
        customerCno,
        totalDue: 0,
        totalPaid: 0,
        totalOverpaid: 0,
        totalOutstanding: 0,
        orderCount: 0,
        orders: [],
      })
    }

    return map
  }, new Map<string, {
    customerName: string
    customerCno: string
    totalDue: number
    totalPaid: number
    totalOverpaid: number
    totalOutstanding: number
    orderCount: number
    orders: Array<{
      id: string
      salesOrderId: string | null
      customerCno: string | null
      orderNumber: string
      orderDate: string | null
      products: string
      amountDue: number
      paidAmount: number
      overpaidAmount: number
      outstanding: number
      paidAt: string | null
      notes: string | null
      partialSettlements: Array<{ at: string; amount: number }>
    }>
  }>())

  filteredRecords.reduce((map, record) => {
    const customerCno = record.customer_cno || "未指定"
    const customerName = record.customer?.name || "散客"
    const key = `${customerCno}-${customerName}`
    const outstanding = record.amount_due - record.paid_amount
    const current = map.get(key)

    if (current) {
      current.totalDue += record.amount_due
      current.totalPaid += record.paid_amount
      current.totalOverpaid += Math.max(0, Number(record.overpaid_amount ?? 0) || 0)
      current.totalOutstanding += outstanding
      current.orderCount += 1
      current.orders.push({
        id: record.id,
        salesOrderId: record.sales_order_id,
        customerCno: record.customer_cno || null,
        orderNumber: record.sales_order?.order_no || "-",
        orderDate: record.sales_order?.order_date || record.due_date || null,
        products:
          record.sales_order?.items
            ?.map((item) => item.product?.name || item.code || "-")
            .filter(Boolean)
            .join("、") || "-",
        amountDue: record.amount_due,
        paidAmount: record.paid_amount,
        overpaidAmount: Math.max(0, Number(record.overpaid_amount ?? 0) || 0),
        outstanding,
        paidAt: record.paid_at || null,
        notes: record.notes || null,
        partialSettlements: parsePartialSettlementNotes(record.notes),
      })
    } else {
      map.set(key, {
        customerName,
        customerCno,
        totalDue: record.amount_due,
        totalPaid: record.paid_amount,
        totalOverpaid: Math.max(0, Number(record.overpaid_amount ?? 0) || 0),
        totalOutstanding: outstanding,
        orderCount: 1,
        orders: [
          {
            id: record.id,
            salesOrderId: record.sales_order_id,
            customerCno: record.customer_cno || null,
            orderNumber: record.sales_order?.order_no || "-",
            orderDate: record.sales_order?.order_date || record.due_date || null,
            products:
              record.sales_order?.items
                ?.map((item) => item.product?.name || item.code || "-")
                .filter(Boolean)
                .join("、") || "-",
            amountDue: record.amount_due,
            paidAmount: record.paid_amount,
            overpaidAmount: Math.max(0, Number(record.overpaid_amount ?? 0) || 0),
            outstanding,
            paidAt: record.paid_at || null,
            notes: record.notes || null,
            partialSettlements: parsePartialSettlementNotes(record.notes),
          },
        ],
      })
    }

    return map
  }, customerSummaryMap)

  const upsertReceivableBySalesOrder = async (payload: {
    salesOrderId: string
    customerCno: string | null
    amountDue: number
    paidAmount: number
    overpaidAmount: number
    paidAt: string | null
    dueDate: string | null
    status: "unpaid" | "partially_paid" | "paid"
    notes?: string | null
  }) => {
    const supabase = createClient()
    const writePayload: Record<string, unknown> = {
      customer_cno: payload.customerCno,
      amount_due: payload.amountDue,
      total_amount: payload.amountDue,
      paid_amount: payload.paidAmount,
      overpaid_amount: payload.overpaidAmount,
      paid_at: payload.paidAt,
      due_date: payload.dueDate,
      status: payload.status,
    }

    if (payload.notes !== undefined) {
      writePayload.notes = payload.notes
    }

    const runUpdate = async (data: Record<string, unknown>) => {
      return supabase
        .from("accounts_receivable")
        .update(data)
        .eq("sales_order_id", payload.salesOrderId)
        .select("id")
        .limit(1)
    }

    const isMissingNotesColumnError = (message?: string) => {
      const text = (message || "").toLowerCase()
      return text.includes("notes") && (text.includes("column") || text.includes("schema cache") || text.includes("could not find"))
    }

    let { data: updatedRows, error: updateError } = await runUpdate(writePayload)
    if (updateError && Object.prototype.hasOwnProperty.call(writePayload, "notes") && isMissingNotesColumnError(updateError.message)) {
      const fallbackPayload = { ...writePayload }
      delete fallbackPayload.notes
      ;({ data: updatedRows, error: updateError } = await runUpdate(fallbackPayload))
    }

    if (updateError) {
      throw new Error(updateError.message || "無法更新應收帳款資料")
    }

    if (updatedRows && updatedRows.length > 0) {
      return
    }

    const insertPayload: Record<string, unknown> = {
      sales_order_id: payload.salesOrderId,
      ...writePayload,
    }

    let { error: insertError } = await supabase
      .from("accounts_receivable")
      .insert(insertPayload)

    if (insertError && Object.prototype.hasOwnProperty.call(insertPayload, "notes") && isMissingNotesColumnError(insertError.message)) {
      const fallbackInsertPayload = { ...insertPayload }
      delete fallbackInsertPayload.notes
      ;({ error: insertError } = await supabase
        .from("accounts_receivable")
        .insert(fallbackInsertPayload))
    }

    if (insertError) {
      throw new Error(insertError.message || "無法建立應收帳款資料")
    }
  }

  const customerSummaries = Array.from(customerSummaryMap.values())
    .filter((summary) => {
      if (!search || summary.orders.length > 0) {
        return true
      }

      const keyword = search.toLowerCase()
      return summary.customerCno.toLowerCase().includes(keyword) || summary.customerName.toLowerCase().includes(keyword)
    })
    .filter((summary) => showAllCustomers || summary.totalOutstanding > 0)
    .sort((a, b) => {
      if (a.customerCno === "未指定" && b.customerCno !== "未指定") return 1
      if (a.customerCno !== "未指定" && b.customerCno === "未指定") return -1

      const aKey = String(a.customerCno || "").trim().toUpperCase()
      const bKey = String(b.customerCno || "").trim().toUpperCase()
      if (aKey === bKey) {
        const aName = String(a.customerName || "").trim().toUpperCase()
        const bName = String(b.customerName || "").trim().toUpperCase()
        return aName === bName ? 0 : aName > bName ? 1 : -1
      }

      return aKey > bKey ? 1 : -1
    })

  const handleBatchSettle = (summary: (typeof customerSummaries)[number]) => {
    const customerKey = `${summary.customerCno}-${summary.customerName}`
    setProcessingCustomerKey(customerKey)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const settledAt = new Date().toISOString()
        const unpaidOrders = summary.orders.filter((order) => order.outstanding > 0)

        if (unpaidOrders.length === 0) {
          toast({
            title: "提示",
            description: "此客戶目前沒有未付款單據",
          })
          return
        }

        const salesOrderIds = unpaidOrders
          .map((order) => order.salesOrderId)
          .filter((id): id is string => Boolean(id))

        if (salesOrderIds.length > 0) {
          const { error: salesUpdateError } = await supabase
            .from("sales_orders")
            .update({ is_paid: true })
            .in("id", salesOrderIds)

          if (salesUpdateError) {
            toast({
              title: "錯誤",
              description: salesUpdateError.message || "無法更新銷貨付款狀態",
              variant: "destructive",
            })
            return
          }
        }

        for (const order of unpaidOrders) {
          if (!order.salesOrderId) continue
          await upsertReceivableBySalesOrder({
            salesOrderId: order.salesOrderId,
            customerCno: summary.customerCno === "未指定" ? null : summary.customerCno,
            amountDue: order.amountDue,
            paidAmount: order.amountDue,
            overpaidAmount: 0,
            paidAt: settledAt,
            dueDate: order.orderDate,
            status: "paid",
          })
        }

        toast({
          title: "成功",
          description: `已完成 ${summary.customerName} 的一鍵沖帳`,
        })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setProcessingCustomerKey(null)
      }
    })
  }

  const handleReceiveByCheck = (summary: (typeof customerSummaries)[number]) => {
    const customerKey = `${summary.customerCno}-${summary.customerName}`
    setProcessingCustomerKey(customerKey)

    startTransition(async () => {
      try {
        const unpaidOrders = summary.orders.filter((order) => order.outstanding > 0)

        if (unpaidOrders.length === 0) {
          toast({
            title: "提示",
            description: "此客戶目前沒有未收款單據",
          })
          return
        }

        for (const order of unpaidOrders) {
          if (!order.salesOrderId) continue

          await upsertReceivableBySalesOrder({
            salesOrderId: order.salesOrderId,
            customerCno: summary.customerCno === "未指定" ? null : summary.customerCno,
            amountDue: order.amountDue,
            paidAmount: order.paidAmount,
            overpaidAmount: order.overpaidAmount,
            paidAt: order.paidAmount > 0 ? order.paidAt : null,
            dueDate: null,
            status: order.paidAmount >= order.amountDue ? "paid" : order.paidAmount > 0 ? "partially_paid" : "unpaid",
            notes: buildCheckLinkedNote(order.notes),
          })
        }

        const salesOrderIds = unpaidOrders
          .map((order) => order.salesOrderId)
          .filter((id): id is string => Boolean(id))
          .join(",")

        const query = new URLSearchParams()
        if (summary.customerCno !== "未指定") {
          query.set("customerCno", summary.customerCno)
        }
        if (salesOrderIds) {
          query.set("salesOrderIds", salesOrderIds)
        }
        query.set("source", "ar")

        toast({ title: "成功", description: "已帶入支票收款資料" })
        router.push(`/accounts-receivable/checks?${query.toString()}`)
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "建立支票收款資料失敗",
          variant: "destructive",
        })
      } finally {
        setProcessingCustomerKey(null)
      }
    })
  }

  const settleSingleOrder = async (order: {
    id: string
    salesOrderId: string | null
    customerCno: string | null
    orderNumber: string
    orderDate: string | null
    amountDue: number
    paidAmount: number
    overpaidAmount: number
  }, paymentAmount: number) => {
    if (!order.salesOrderId) {
      toast({
        title: "錯誤",
        description: "缺少銷貨單據關聯，無法執行沖帳",
        variant: "destructive",
      })
      return
    }

    const normalizedPayment = Number.isFinite(paymentAmount) ? paymentAmount : 0
    if (normalizedPayment <= 0) {
      toast({
        title: "錯誤",
        description: "請輸入大於 0 的沖帳金額",
        variant: "destructive",
      })
      return
    }

    const currentPaid = Math.max(0, Math.min(order.paidAmount, order.amountDue))
    const baseNeedAmount = Math.max(0, order.amountDue - currentPaid)
    const supabase = createClient()
    let remainingNeed = baseNeedAmount
    let consumedCarryover = 0

    if (order.customerCno) {
      const { data: overpaidRows, error: overpaidQueryError } = await supabase
        .from("accounts_receivable")
        .select("id,overpaid_amount")
        .eq("customer_cno", order.customerCno)
        .gt("overpaid_amount", 0)
        .neq("sales_order_id", order.salesOrderId)
        .order("created_at", { ascending: true })

      if (overpaidQueryError) {
        throw new Error(overpaidQueryError.message || "無法取得客戶溢收資料")
      }

      for (const row of overpaidRows || []) {
        if (remainingNeed <= 0) break
        const rowOverpaid = Math.max(0, Number(row.overpaid_amount ?? 0) || 0)
        if (rowOverpaid <= 0) continue

        const consume = Math.min(rowOverpaid, remainingNeed)
        const nextOverpaid = rowOverpaid - consume

        const { error: consumeError } = await supabase
          .from("accounts_receivable")
          .update({ overpaid_amount: nextOverpaid })
          .eq("id", row.id)

        if (consumeError) {
          throw new Error(consumeError.message || "無法套用客戶溢收抵扣")
        }

        consumedCarryover += consume
        remainingNeed -= consume
      }
    }

    const appliedCash = Math.min(normalizedPayment, remainingNeed)
    remainingNeed -= appliedCash
    const generatedOverpaid = Math.max(0, normalizedPayment - appliedCash)

    const nextPaidAmount = Math.min(order.amountDue, currentPaid + consumedCarryover + appliedCash)
    const nextOverpaidAmount = Math.max(0, Number(order.overpaidAmount || 0) + generatedOverpaid)
    const isFullyPaid = nextPaidAmount >= order.amountDue
    const nextStatus: "unpaid" | "partially_paid" | "paid" =
      nextPaidAmount <= 0
        ? "unpaid"
        : isFullyPaid
          ? "paid"
          : "partially_paid"

    if (nextPaidAmount <= currentPaid) {
      toast({
        title: "提示",
        description: "此單據目前沒有可沖帳金額",
      })
      return
    }

    const settledAt = new Date().toISOString()
    const { error: salesUpdateError } = await supabase
      .from("sales_orders")
      .update({ is_paid: isFullyPaid })
      .eq("id", order.salesOrderId)

    if (salesUpdateError) {
      toast({
        title: "錯誤",
        description: salesUpdateError.message || "無法更新銷貨付款狀態",
        variant: "destructive",
      })
      return
    }

    await upsertReceivableBySalesOrder({
      salesOrderId: order.salesOrderId,
      customerCno: order.customerCno,
      amountDue: order.amountDue,
      paidAmount: nextPaidAmount,
      overpaidAmount: nextOverpaidAmount,
      paidAt: nextPaidAmount > 0 ? settledAt : null,
      dueDate: order.orderDate,
      status: nextStatus,
    })

    let autoAllocatedAmount = 0
    if (order.customerCno && order.salesOrderId) {
      autoAllocatedAmount = await autoAllocateCustomerOverpaid({
        customerCno: order.customerCno,
        sourceSalesOrderId: order.salesOrderId,
        settledAt,
      })
    }

    toast({
      title: "成功",
      description:
        autoAllocatedAmount > 0
          ? `單號 ${order.orderNumber} 已沖帳，並自動回補其他單據 ${formatCurrencyOneDecimal(autoAllocatedAmount)}`
          : generatedOverpaid > 0
            ? `單號 ${order.orderNumber} 已完成沖帳，溢收 ${formatCurrencyOneDecimal(generatedOverpaid)} 將在下次自動抵扣`
          : consumedCarryover > 0
            ? `單號 ${order.orderNumber} 已沖帳，已自動抵扣溢收 ${formatCurrencyOneDecimal(consumedCarryover)}`
            : isFullyPaid
              ? `單號 ${order.orderNumber} 已完成沖帳`
              : `單號 ${order.orderNumber} 已完成部分沖帳`,
    })
    router.refresh()
  }

  const autoAllocateCustomerOverpaid = async (params: {
    customerCno: string
    sourceSalesOrderId: string
    settledAt: string
  }) => {
    const supabase = createClient()
    const { data: sourceRow, error: sourceError } = await supabase
      .from("accounts_receivable")
      .select("id,overpaid_amount")
      .eq("sales_order_id", params.sourceSalesOrderId)
      .maybeSingle()

    if (sourceError) {
      throw new Error(sourceError.message || "無法取得溢收來源資料")
    }

    const sourceOverpaid = Math.max(0, Number(sourceRow?.overpaid_amount ?? 0) || 0)
    if (!sourceRow?.id || sourceOverpaid <= 0) {
      return 0
    }

    const { data: targetRows, error: targetError } = await supabase
      .from("accounts_receivable")
      .select("id,sales_order_id,amount_due,paid_amount")
      .eq("customer_cno", params.customerCno)
      .neq("sales_order_id", params.sourceSalesOrderId)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true })

    if (targetError) {
      throw new Error(targetError.message || "無法取得可抵扣單據")
    }

    let remainingOverpaid = sourceOverpaid

    for (const row of targetRows || []) {
      if (remainingOverpaid <= 0) break

      const amountDue = Math.max(0, Number(row.amount_due ?? 0) || 0)
      const paidAmount = Math.max(0, Math.min(amountDue, Number(row.paid_amount ?? 0) || 0))
      const outstanding = Math.max(0, amountDue - paidAmount)

      if (outstanding <= 0) continue

      const allocateAmount = Math.min(remainingOverpaid, outstanding)
      const nextPaidAmount = paidAmount + allocateAmount
      const isTargetPaid = nextPaidAmount >= amountDue
      const nextStatus: "unpaid" | "partially_paid" | "paid" =
        nextPaidAmount <= 0
          ? "unpaid"
          : isTargetPaid
            ? "paid"
            : "partially_paid"

      const { error: updateTargetError } = await supabase
        .from("accounts_receivable")
        .update({
          paid_amount: nextPaidAmount,
          status: nextStatus,
          paid_at: params.settledAt,
        })
        .eq("id", row.id)

      if (updateTargetError) {
        throw new Error(updateTargetError.message || "無法更新抵扣目標單據")
      }

      if (row.sales_order_id) {
        const { error: salesUpdateError } = await supabase
          .from("sales_orders")
          .update({ is_paid: isTargetPaid })
          .eq("id", row.sales_order_id)

        if (salesUpdateError) {
          throw new Error(salesUpdateError.message || "無法更新抵扣目標銷貨付款狀態")
        }
      }

      remainingOverpaid -= allocateAmount
    }

    if (remainingOverpaid !== sourceOverpaid) {
      const { error: sourceUpdateError } = await supabase
        .from("accounts_receivable")
        .update({ overpaid_amount: remainingOverpaid })
        .eq("id", sourceRow.id)

      if (sourceUpdateError) {
        throw new Error(sourceUpdateError.message || "無法更新溢收餘額")
      }
    }

    return sourceOverpaid - remainingOverpaid
  }

  const restoreSingleOrder = async (order: {
    id: string
    salesOrderId: string | null
    customerCno: string | null
    orderNumber: string
    orderDate: string | null
    amountDue: number
  }) => {
    if (!order.salesOrderId) {
      toast({
        title: "錯誤",
        description: "缺少銷貨單據關聯，無法恢復未付",
        variant: "destructive",
      })
      return
    }

    const supabase = createClient()
    const { error: salesUpdateError } = await supabase
      .from("sales_orders")
      .update({ is_paid: false, status: "pending" })
      .eq("id", order.salesOrderId)

    if (salesUpdateError) {
      toast({
        title: "錯誤",
        description: salesUpdateError.message || "無法更新銷貨狀態",
        variant: "destructive",
      })
      return
    }

    await upsertReceivableBySalesOrder({
      salesOrderId: order.salesOrderId,
      customerCno: order.customerCno,
      amountDue: order.amountDue,
      paidAmount: 0,
      overpaidAmount: 0,
      paidAt: null,
      dueDate: order.orderDate,
      status: "unpaid",
      notes: null,
    })

    toast({
      title: "成功",
      description: `單號 ${order.orderNumber} 已恢復為未付款`,
    })
    router.refresh()
  }

  const handleSingleOrderAction = (order: {
    id: string
    salesOrderId: string | null
    customerCno: string | null
    orderNumber: string
    orderDate: string | null
    amountDue: number
  }) => {
    setProcessingOrderId(order.id)
    startRowActionTransition(async () => {
      try {
        await restoreSingleOrder(order)
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setProcessingOrderId(null)
        setRestoreTargetOrder(null)
      }
    })
  }

  const handleFullSettleAction = (order: {
    id: string
    salesOrderId: string | null
    customerCno: string | null
    orderNumber: string
    orderDate: string | null
    amountDue: number
    paidAmount: number
    overpaidAmount: number
    outstanding: number
  }) => {
    if (order.outstanding <= 0) {
      toast({
        title: "提示",
        description: "此單據目前沒有未收金額",
      })
      return
    }

    setProcessingOrderId(order.id)
    startRowActionTransition(async () => {
      try {
        await settleSingleOrder(order, order.outstanding)
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setProcessingOrderId(null)
      }
    })
  }

  const handleOpenPartialSettle = (summary: (typeof customerSummaries)[number]) => {
    setPartialSettleTarget({
      customerCno: summary.customerCno,
      customerName: summary.customerName,
      totalOutstanding: summary.totalOutstanding,
      orders: summary.orders,
    })
    setPartialPaymentAmount(summary.totalOutstanding.toString())
  }

  const handleConfirmPartialSettle = () => {
    if (!partialSettleTarget) return

    const payment = Number(partialPaymentAmount.replace(/,/g, ""))
    if (!Number.isFinite(payment) || payment <= 0) {
      toast({
        title: "錯誤",
        description: "請輸入正確的沖帳金額",
        variant: "destructive",
      })
      return
    }

    const customerKey = `${partialSettleTarget.customerCno}-${partialSettleTarget.customerName}`
    setProcessingCustomerKey(customerKey)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const settledAt = new Date().toISOString()
        const totalExistingOverpaid = partialSettleTarget.orders.reduce((sum, order) => sum + Math.max(0, order.overpaidAmount), 0)
        let distributableAmount = payment + totalExistingOverpaid

        const targetOrders = [...partialSettleTarget.orders]
          .filter((order) => order.salesOrderId)
          .sort((a, b) => {
            const aTime = a.orderDate ? new Date(a.orderDate).getTime() : Number.MAX_SAFE_INTEGER
            const bTime = b.orderDate ? new Date(b.orderDate).getTime() : Number.MAX_SAFE_INTEGER
            return aTime - bTime
          })

        const updatedOrders: Array<{
          salesOrderId: string
          customerCno: string | null
          orderDate: string | null
          amountDue: number
          paidAmount: number
          overpaidAmount: number
          status: "unpaid" | "partially_paid" | "paid"
          notes: string | null
        }> = []

        for (const order of targetOrders) {
          if (!order.salesOrderId) continue

          const currentPaidAmount = Math.max(0, Math.min(order.amountDue, order.paidAmount))
          const outstandingAmount = Math.max(0, order.amountDue - currentPaidAmount)
          const appliedAmount = Math.min(distributableAmount, outstandingAmount)
          const nextPaidAmount = Math.min(order.amountDue, currentPaidAmount + appliedAmount)
          const isFullyPaid = nextPaidAmount >= order.amountDue
          const status: "unpaid" | "partially_paid" | "paid" =
            nextPaidAmount <= 0
              ? "unpaid"
              : isFullyPaid
                ? "paid"
                : "partially_paid"

          const nextNotes = order.notes

          const { error: salesUpdateError } = await supabase
            .from("sales_orders")
            .update({ is_paid: isFullyPaid })
            .eq("id", order.salesOrderId)

          if (salesUpdateError) {
            throw new Error(salesUpdateError.message || "無法更新銷貨付款狀態")
          }

          await upsertReceivableBySalesOrder({
            salesOrderId: order.salesOrderId,
            customerCno: order.customerCno,
            amountDue: order.amountDue,
            paidAmount: nextPaidAmount,
            overpaidAmount: 0,
            paidAt: settledAt,
            dueDate: order.orderDate,
            status,
            notes: nextNotes,
          })

          distributableAmount -= appliedAmount
          updatedOrders.push({
            salesOrderId: order.salesOrderId,
            customerCno: order.customerCno,
            orderDate: order.orderDate,
            amountDue: order.amountDue,
            paidAmount: nextPaidAmount,
            overpaidAmount: 0,
            status,
            notes: nextNotes,
          })
        }

        if (distributableAmount > 0 && updatedOrders.length > 0) {
          const carrierOrder = updatedOrders[0]
          await upsertReceivableBySalesOrder({
            salesOrderId: carrierOrder.salesOrderId,
            customerCno: carrierOrder.customerCno,
            amountDue: carrierOrder.amountDue,
            paidAmount: carrierOrder.paidAmount,
            overpaidAmount: distributableAmount,
            paidAt: settledAt,
            dueDate: carrierOrder.orderDate,
            status: carrierOrder.status,
            notes: carrierOrder.notes,
          })
        }

        const latestOrderForRecord = [...partialSettleTarget.orders]
          .filter((order) => Boolean(order.salesOrderId))
          .sort((a, b) => {
            const aTime = a.orderDate ? new Date(a.orderDate).getTime() : 0
            const bTime = b.orderDate ? new Date(b.orderDate).getTime() : 0
            return bTime - aTime
          })[0]

        if (latestOrderForRecord?.salesOrderId) {
          const { data: latestRow, error: latestRowError } = await supabase
            .from("accounts_receivable")
            .select("customer_cno,amount_due,paid_amount,overpaid_amount,paid_at,due_date,status,notes")
            .eq("sales_order_id", latestOrderForRecord.salesOrderId)
            .maybeSingle()

          if (latestRowError) {
            throw new Error(latestRowError.message || "無法更新部分沖帳紀錄")
          }

          if (latestRow) {
            await upsertReceivableBySalesOrder({
              salesOrderId: latestOrderForRecord.salesOrderId,
              customerCno: latestRow.customer_cno,
              amountDue: Number(latestRow.amount_due || 0),
              paidAmount: Number(latestRow.paid_amount || 0),
              overpaidAmount: Number(latestRow.overpaid_amount || 0),
              paidAt: latestRow.paid_at || settledAt,
              dueDate: latestRow.due_date || latestOrderForRecord.orderDate,
              status: (latestRow.status as "unpaid" | "partially_paid" | "paid") || "unpaid",
              notes: buildPartialSettlementNote(latestRow.notes, settledAt, payment),
            })
          }
        }

        setPartialSettleTarget(null)
        setPartialPaymentAmount("")
        toast({
          title: "成功",
          description: distributableAmount > 0
            ? `已完成 ${partialSettleTarget.customerName} 的部分沖帳（${formatCurrencyOneDecimal(payment)}），並產生溢收 ${formatCurrencyOneDecimal(distributableAmount)}`
            : `已完成 ${partialSettleTarget.customerName} 的部分沖帳（${formatCurrencyOneDecimal(payment)}）`,
        })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setProcessingCustomerKey(null)
      }
    })
  }

  const handleExportStatement = (summary: (typeof customerSummaries)[number]) => {
    const outstandingOrders = summary.orders.filter((order) => order.outstanding > 0)

    if (outstandingOrders.length === 0) {
      toast({
        title: "提示",
        description: "此客戶目前沒有未收款資料可匯出",
      })
      return
    }

    const headers = ["客戶名稱", "客戶代號", "銷貨單號", "日期", "商品", "單筆金額", "已收金額", "未收金額", "溢收款"]
    const lines = outstandingOrders.map((order) => {
      const dateText = order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"
      return [
        summary.customerName,
        summary.customerCno,
        order.orderNumber,
        dateText,
        order.products,
        order.amountDue.toString(),
        order.paidAmount.toString(),
        order.outstanding.toString(),
        order.overpaidAmount.toString(),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    })

    const statementTotal = outstandingOrders.reduce((sum, order) => sum + order.amountDue, 0)
    const totalLine = ["", "", "", "", "總金額", statementTotal.toString(), "", "", ""]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(",")

    const csv = `\uFEFF${headers.join(",")}\n${lines.join("\n")}\n${totalLine}`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const dateStamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `${summary.customerName}-對帳單-${dateStamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast({
      title: "成功",
      description: "已匯出對帳單",
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋客戶、單號..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => setIsPrivacyMode((prev) => !prev)}
          aria-label={isPrivacyMode ? "顯示金額" : "隱藏金額"}
          title={isPrivacyMode ? "顯示金額" : "隱藏金額"}
        >
          {isPrivacyMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant={showAllCustomers ? "outline" : "default"}
            size="sm"
            onClick={() => setShowAllCustomers(false)}
          >
            只看欠款客戶
          </Button>
          <Button
            variant={showAllCustomers ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAllCustomers(true)}
          >
            顯示全部客戶
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應收合計</p>
          <p className="text-2xl font-semibold">{renderAmount(totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">已收金額</p>
          <p className="text-2xl font-semibold">{renderAmount(paidAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應收未付</p>
          <p className="text-2xl font-semibold text-destructive">
            {isPrivacyMode ? <span className="text-muted-foreground tracking-widest">****</span> : formatCurrencyOneDecimal(outstandingAmount)}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">可抵扣溢收款：{renderAmount(overpaidAmount)}</p>

      <div className="rounded-lg border">
        {customerSummaries.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {search
              ? "找不到符合的客戶歸戶資料"
              : showAllCustomers
                ? "尚無客戶歸戶資料"
                : "目前沒有欠款客戶"}
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {customerSummaries.map((summary) => (
              <AccordionItem key={`${summary.customerCno}-${summary.customerName}`} value={`${summary.customerCno}-${summary.customerName}`}>
                {(() => {
                  const visibleOrders = showAllCustomers
                    ? [...summary.orders]
                    : summary.orders.filter((order) => order.outstanding > 0)
                  const sortedOrders = visibleOrders.sort((a, b) => {
                    const aTime = a.orderDate ? new Date(a.orderDate).getTime() : 0
                    const bTime = b.orderDate ? new Date(b.orderDate).getTime() : 0
                    return bTime - aTime
                  })
                  const visibleOrderCount = showAllCustomers ? summary.orderCount : sortedOrders.length

                  return (
                <>
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                    <div className="col-span-4">
                      <p className="font-medium">{summary.customerName}</p>
                      <p className="text-xs text-muted-foreground">{summary.customerCno}・{visibleOrderCount} 筆單據</p>
                    </div>
                    <div className="col-span-4 text-right text-sm text-muted-foreground">
                      應收合計 {renderAmount(summary.totalDue)}
                    </div>
                    <div className="col-span-4 text-right text-base font-semibold text-destructive">
                      總欠款 {renderAmount(summary.totalOutstanding)}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="mb-3 flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportStatement(summary)}
                      disabled={isPending && processingCustomerKey === `${summary.customerCno}-${summary.customerName}`}
                    >
                      匯出對帳單
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          disabled={isPending && processingCustomerKey === `${summary.customerCno}-${summary.customerName}`}
                        >
                          {isPending && processingCustomerKey === `${summary.customerCno}-${summary.customerName}` ? "處理中..." : "付款方式"}
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleBatchSettle(summary)}>
                          現金
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleReceiveByCheck(summary)}>
                          支票
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleOpenPartialSettle(summary)}>
                          部分沖帳
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs md:text-base">
                          <TableHead className="px-1 py-1 md:px-2 md:py-2 font-medium">銷貨單號</TableHead>
                          <TableHead className="hidden sm:table-cell px-1 py-1 md:px-2 md:py-2 font-medium">日期</TableHead>
                          <TableHead className="px-1 py-1 md:px-2 md:py-2 font-medium">商品</TableHead>
                          <TableHead className="text-right px-1 py-1 md:px-2 md:py-2 font-medium">單筆金額</TableHead>
                          <TableHead className="hidden sm:table-cell text-right px-1 py-1 md:px-2 md:py-2 font-medium">已收金額</TableHead>
                          <TableHead className="text-right px-1 py-1 md:px-2 md:py-2 font-medium">未收金額</TableHead>
                          <TableHead className="hidden sm:table-cell text-right px-1 py-1 md:px-2 md:py-2 font-medium">溢收款</TableHead>
                          <TableHead className="hidden sm:table-cell text-center px-1 py-1 md:px-2 md:py-2 font-medium">狀態</TableHead>
                          <TableHead className="hidden md:table-cell text-center px-1 py-1 md:px-2 md:py-2 font-medium">沖帳日期</TableHead>
                          <TableHead className="hidden md:table-cell text-center px-1 py-1 md:px-2 md:py-2 font-medium">部分沖帳紀錄</TableHead>
                          <TableHead className="text-right px-1 py-1 md:px-2 md:py-2 font-medium">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedOrders.map((order) => {
                          const isPaid = order.outstanding <= 0
                          const isPartiallyPaid = !isPaid && order.paidAmount > 0
                          const isThisOrderProcessing = isRowActionPending && processingOrderId === order.id
                          const partialSettlements = order.partialSettlements

                          return (
                            <TableRow key={order.id} className="text-xs md:text-base">
                              <TableCell className="font-medium px-1 py-1 md:px-2 md:py-2">{order.orderNumber}</TableCell>
                              <TableCell className="hidden sm:table-cell px-1 py-1 md:px-2 md:py-2">
                                {order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}
                              </TableCell>
                              <TableCell className="px-1 py-1 md:px-2 md:py-2">{order.products}</TableCell>
                              <TableCell className="text-right px-1 py-1 md:px-2 md:py-2">{formatCurrencyOneDecimal(order.amountDue)}</TableCell>
                              <TableCell className="hidden sm:table-cell text-right px-1 py-1 md:px-2 md:py-2">{formatCurrencyOneDecimal(order.paidAmount)}</TableCell>
                              <TableCell className="text-right px-1 py-1 md:px-2 md:py-2">{formatCurrencyOneDecimal(order.outstanding)}</TableCell>
                              <TableCell className="hidden sm:table-cell text-right px-1 py-1 md:px-2 md:py-2">{formatCurrencyOneDecimal(order.overpaidAmount)}</TableCell>
                              <TableCell className="hidden sm:table-cell text-center px-1 py-1 md:px-2 md:py-2">
                                <span className={isPaid ? "text-foreground" : isPartiallyPaid ? "text-primary" : "text-destructive"}>
                                  {isPaid ? "已付款" : isPartiallyPaid ? "部分付款" : "未付款"}
                                </span>
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-center text-xs text-muted-foreground px-1 py-1 md:px-2 md:py-2">
                                {order.paidAt && order.paidAmount > 0 ? new Date(order.paidAt).toLocaleString("zh-TW") : "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-center text-xs text-muted-foreground px-1 py-1 md:px-2 md:py-2">
                                {partialSettlements.length > 0 ? (
                                  <div className="space-y-1 text-left inline-block">
                                    {partialSettlements.map((entry, index) => (
                                      <div key={`${entry.at}-${entry.amount}-${index}`}>
                                        {new Date(entry.at).toLocaleString("zh-TW")} 部分沖帳 {formatCurrencyOneDecimal(entry.amount)}
                                      </div>
                                    ))}
                                  </div>
                                ) : "-"}
                              </TableCell>
                              <TableCell className="text-right px-1 py-1 md:px-2 md:py-2">
                                {isPaid ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isThisOrderProcessing}
                                    onClick={() => {
                                      setRestoreTargetOrder({
                                        id: order.id,
                                        salesOrderId: order.salesOrderId,
                                        customerCno: order.customerCno,
                                        orderNumber: order.orderNumber,
                                        orderDate: order.orderDate,
                                        amountDue: order.amountDue,
                                      })
                                    }}
                                  >
                                    {isThisOrderProcessing ? "處理中..." : "恢復未付"}
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={isThisOrderProcessing}
                                    onClick={() => handleFullSettleAction(order)}
                                  >
                                    {isThisOrderProcessing ? "處理中..." : "沖帳"}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        <TableRow className="bg-muted/40 text-xs md:text-base">
                          <TableCell colSpan={3} className="text-right font-semibold px-1 py-1 md:px-2 md:py-2">總計</TableCell>
                          <TableCell className="text-right font-semibold px-1 py-1 md:px-2 md:py-2">
                            {formatCurrencyOneDecimal(sortedOrders.reduce((sum, order) => sum + order.amountDue, 0))}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-right font-semibold px-1 py-1 md:px-2 md:py-2">
                            {formatCurrencyOneDecimal(sortedOrders.reduce((sum, order) => sum + order.paidAmount, 0))}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-destructive px-1 py-1 md:px-2 md:py-2">
                            {formatCurrencyOneDecimal(sortedOrders.reduce((sum, order) => sum + order.outstanding, 0))}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-right font-semibold px-1 py-1 md:px-2 md:py-2">
                            {formatCurrencyOneDecimal(sortedOrders.reduce((sum, order) => sum + order.overpaidAmount, 0))}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell px-1 py-1 md:px-2 md:py-2" colSpan={2} />
                          <TableCell className="hidden md:table-cell text-center font-semibold text-primary px-1 py-1 md:px-2 md:py-2">
                            {(() => {
                              const partialCount = sortedOrders.reduce((count, order) => count + order.partialSettlements.length, 0)
                              const partialTotal = sortedOrders.reduce(
                                (sum, order) => sum + order.partialSettlements.reduce((inner, entry) => inner + entry.amount, 0),
                                0,
                              )
                              return `共 ${partialCount} 次 / ${formatCurrencyOneDecimal(partialTotal)}`
                            })()}
                          </TableCell>
                          <TableCell className="px-1 py-1 md:px-2 md:py-2" />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
                </>
                  )
                })()}
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <Dialog open={Boolean(partialSettleTarget)} onOpenChange={(open) => !open && setPartialSettleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>部分沖帳</DialogTitle>
            <DialogDescription>
              {partialSettleTarget
                ? `客戶 ${partialSettleTarget.customerName} 總欠款：${formatCurrencyOneDecimal(partialSettleTarget.totalOutstanding)}（將依序扣抵所有未收單據）`
                : "請輸入本次沖帳金額"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="partial-settle-amount">本次沖帳金額</Label>
            <Input
              id="partial-settle-amount"
              type="number"
              min={0}
              step="0.01"
              value={partialPaymentAmount}
              onChange={(e) => setPartialPaymentAmount(e.target.value)}
              disabled={isPending}
            />
            {partialSettleTarget && (
              <p className="text-xs text-muted-foreground">
                預估扣抵後剩餘欠款：
                {formatCurrencyOneDecimal(Math.max(0, partialSettleTarget.totalOutstanding - (Number(partialPaymentAmount || 0) || 0)))}，
                預估溢收：
                {formatCurrencyOneDecimal(Math.max(0, (Number(partialPaymentAmount || 0) || 0) - partialSettleTarget.totalOutstanding))}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPartialSettleTarget(null)}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="button" onClick={handleConfirmPartialSettle} disabled={isPending || !partialSettleTarget}>
              {isPending ? "處理中..." : "確認沖帳"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(restoreTargetOrder)} onOpenChange={(open) => !open && setRestoreTargetOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認恢復未付款</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreTargetOrder
                ? `確定要將單號 ${restoreTargetOrder.orderNumber} 恢復為未付款狀態嗎？`
                : "確定要恢復為未付款狀態嗎？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRowActionPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRowActionPending || !restoreTargetOrder}
              onClick={(e) => {
                e.preventDefault()
                if (!restoreTargetOrder) return
                handleSingleOrderAction(restoreTargetOrder)
              }}
            >
              {isRowActionPending ? "處理中..." : "確認恢復"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
