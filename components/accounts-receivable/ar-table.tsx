"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Search } from "lucide-react"
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
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { AccountsReceivable } from "@/lib/types"

interface ARTableProps {
  records: AccountsReceivable[]
  allCustomers?: Array<{
    code: string
    name: string
  }>
}

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
  const outstandingAmount = totalAmount - paidAmount

  const renderAmount = (value: number) => {
    if (isPrivacyMode) {
      return <span className="text-muted-foreground tracking-widest">****</span>
    }

    return `$${value.toLocaleString()}`
  }

  const customerSummaryMap = allCustomers.reduce((map, customer) => {
    const customerCno = customer.code || "未指定"
    const customerName = customer.name || "未指定客戶"
    const key = `${customerCno}-${customerName}`

    if (!map.has(key)) {
      map.set(key, {
        customerName,
        customerCno,
        totalDue: 0,
        totalPaid: 0,
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
      outstanding: number
      isPaid: boolean
      paidAt: string | null
    }>
  }>())

  filteredRecords.reduce((map, record) => {
    const customerCno = record.customer_cno || "未指定"
    const customerName = record.customer?.name || "未指定客戶"
    const key = `${customerCno}-${customerName}`
    const outstanding = record.amount_due - record.paid_amount
    const current = map.get(key)

    if (current) {
      current.totalDue += record.amount_due
      current.totalPaid += record.paid_amount
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
        outstanding,
        isPaid: record.sales_order?.is_paid === true,
        paidAt: record.paid_at || null,
      })
    } else {
      map.set(key, {
        customerName,
        customerCno,
        totalDue: record.amount_due,
        totalPaid: record.paid_amount,
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
            outstanding,
            isPaid: record.sales_order?.is_paid === true,
            paidAt: record.paid_at || null,
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
    paidAt: string | null
    dueDate: string | null
    status: "unpaid" | "partially_paid" | "paid"
  }) => {
    const supabase = createClient()
    const writePayload = {
      customer_cno: payload.customerCno,
      amount_due: payload.amountDue,
      total_amount: payload.amountDue,
      paid_amount: payload.paidAmount,
      paid_at: payload.paidAt,
      due_date: payload.dueDate,
      status: payload.status,
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("accounts_receivable")
      .update(writePayload)
      .eq("sales_order_id", payload.salesOrderId)
      .select("id")
      .limit(1)

    if (updateError) {
      throw new Error(updateError.message || "無法更新應收帳款資料")
    }

    if (updatedRows && updatedRows.length > 0) {
      return
    }

    const { error: insertError } = await supabase
      .from("accounts_receivable")
      .insert({
        sales_order_id: payload.salesOrderId,
        ...writePayload,
      })

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
      return a.customerCno.localeCompare(b.customerCno, "zh-Hant", {
        numeric: true,
        sensitivity: "base",
      })
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

  const settleSingleOrder = async (order: {
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
        description: "缺少銷貨單據關聯，無法執行沖帳",
        variant: "destructive",
      })
      return
    }

    const supabase = createClient()
    const settledAt = new Date().toISOString()
    const { error: salesUpdateError } = await supabase
      .from("sales_orders")
      .update({ is_paid: true })
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
      paidAmount: order.amountDue,
      paidAt: settledAt,
      dueDate: order.orderDate,
      status: "paid",
    })

    toast({
      title: "成功",
      description: `單號 ${order.orderNumber} 已完成沖帳`,
    })
    router.refresh()
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
      paidAt: null,
      dueDate: order.orderDate,
      status: "unpaid",
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
    outstanding: number
  }) => {
    setProcessingOrderId(order.id)
    startRowActionTransition(async () => {
      try {
        if (order.outstanding > 0) {
          await settleSingleOrder(order)
        } else {
          await restoreSingleOrder(order)
        }
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

  const handleExportStatement = (summary: (typeof customerSummaries)[number]) => {
    const outstandingOrders = summary.orders.filter((order) => order.outstanding > 0)

    if (outstandingOrders.length === 0) {
      toast({
        title: "提示",
        description: "此客戶目前沒有未收款資料可匯出",
      })
      return
    }

    const headers = ["客戶名稱", "客戶代號", "銷貨單號", "日期", "商品", "單筆金額", "已收金額", "未收金額"]
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
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    })

    const statementTotal = outstandingOrders.reduce((sum, order) => sum + order.amountDue, 0)
    const totalLine = ["", "", "", "", "總金額", statementTotal.toString(), "", ""]
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
            {isPrivacyMode ? <span className="text-muted-foreground tracking-widest">****</span> : `$${outstandingAmount.toLocaleString()}`}
          </p>
        </div>
      </div>

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
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                    <div className="col-span-4">
                      <p className="font-medium">{summary.customerName}</p>
                      <p className="text-xs text-muted-foreground">{summary.customerCno}・{summary.orderCount} 筆單據</p>
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
                    <Button
                      size="sm"
                      onClick={() => handleBatchSettle(summary)}
                      disabled={isPending && processingCustomerKey === `${summary.customerCno}-${summary.customerName}`}
                    >
                      {isPending && processingCustomerKey === `${summary.customerCno}-${summary.customerName}` ? "處理中..." : "一鍵沖帳"}
                    </Button>
                  </div>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>銷貨單號</TableHead>
                          <TableHead>日期</TableHead>
                          <TableHead>商品</TableHead>
                          <TableHead className="text-right">單筆金額</TableHead>
                          <TableHead className="text-right">未收金額</TableHead>
                          <TableHead className="text-center">狀態</TableHead>
                          <TableHead className="text-center">沖帳日期</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.orders.map((order) => {
                          const isPaid = order.isPaid || order.outstanding <= 0
                          const isThisOrderProcessing = isRowActionPending && processingOrderId === order.id

                          return (
                            <TableRow key={order.id}>
                              <TableCell className="font-medium">{order.orderNumber}</TableCell>
                              <TableCell>
                                {order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}
                              </TableCell>
                              <TableCell>{order.products}</TableCell>
                              <TableCell className="text-right">${order.amountDue.toLocaleString()}</TableCell>
                              <TableCell className="text-right">${order.outstanding.toLocaleString()}</TableCell>
                              <TableCell className="text-center">
                                <span className={isPaid ? "text-foreground" : "text-destructive"}>{isPaid ? "已付款" : "未付款"}</span>
                              </TableCell>
                              <TableCell className="text-center text-sm text-muted-foreground">
                                {isPaid && order.paidAt ? new Date(order.paidAt).toLocaleString("zh-TW") : "-"}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant={isPaid ? "outline" : "default"}
                                  disabled={isThisOrderProcessing}
                                  onClick={() => {
                                    if (isPaid) {
                                      setRestoreTargetOrder({
                                        id: order.id,
                                        salesOrderId: order.salesOrderId,
                                        customerCno: order.customerCno,
                                        orderNumber: order.orderNumber,
                                        orderDate: order.orderDate,
                                        amountDue: order.amountDue,
                                      })
                                      return
                                    }

                                    handleSingleOrderAction(order)
                                  }}
                                >
                                  {isThisOrderProcessing ? "處理中..." : isPaid ? "恢復未付" : "一鍵沖帳"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        <TableRow className="bg-muted/40">
                          <TableCell colSpan={4} className="text-right font-semibold">總金額</TableCell>
                          <TableCell className="text-right font-semibold">
                            ${summary.orders.reduce((sum, order) => sum + order.amountDue, 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-destructive">
                            ${summary.orders.reduce((sum, order) => sum + order.outstanding, 0).toLocaleString()}
                          </TableCell>
                          <TableCell colSpan={2} />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

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
                handleSingleOrderAction({ ...restoreTargetOrder, outstanding: 0 })
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
