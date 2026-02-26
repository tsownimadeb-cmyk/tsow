"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { AccountsReceivable } from "@/lib/types"

interface ARTableProps {
  records: AccountsReceivable[]
}

export function ARTable({ records }: ARTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [processingCustomerKey, setProcessingCustomerKey] = useState<string | null>(null)

  const filteredRecords = records.filter(
    (record) =>
      record.customer_cno?.toLowerCase().includes(search.toLowerCase()) ||
      record.customer?.name?.toLowerCase().includes(search.toLowerCase()) ||
      record.sales_order?.order_no?.toLowerCase().includes(search.toLowerCase()),
  )

  const totalAmount = filteredRecords.reduce((sum, record) => sum + record.amount_due, 0)
  const paidAmount = filteredRecords.reduce((sum, record) => sum + record.paid_amount, 0)
  const outstandingAmount = totalAmount - paidAmount

  const customerSummaryMap = filteredRecords.reduce((map, record) => {
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
          },
        ],
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
      orderNumber: string
      orderDate: string | null
      products: string
      amountDue: number
      paidAmount: number
      outstanding: number
    }>
  }>())

  const customerSummaries = Array.from(customerSummaryMap.values())
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

          if (order.id.startsWith("virtual-")) {
            const { error: insertError } = await supabase.from("accounts_receivable").insert({
              sales_order_id: order.salesOrderId,
              customer_cno: summary.customerCno === "未指定" ? null : summary.customerCno,
              amount_due: order.amountDue,
              total_amount: order.amountDue,
              paid_amount: order.amountDue,
              due_date: order.orderDate,
              status: "paid",
            })

            if (insertError) {
              toast({
                title: "錯誤",
                description: insertError.message || "無法建立應收帳款資料",
                variant: "destructive",
              })
              return
            }
          } else {
            const { error: updateError } = await supabase
              .from("accounts_receivable")
              .update({
                paid_amount: order.amountDue,
                status: "paid",
              })
              .eq("id", order.id)

            if (updateError) {
              toast({
                title: "錯誤",
                description: updateError.message || "無法更新應收帳款資料",
                variant: "destructive",
              })
              return
            }
          }
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
          <p className="text-2xl font-semibold">${totalAmount.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">已收金額</p>
          <p className="text-2xl font-semibold">${paidAmount.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應收未付</p>
          <p className="text-2xl font-semibold text-destructive">${outstandingAmount.toLocaleString()}</p>
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
                      應收合計 ${summary.totalDue.toLocaleString()}
                    </div>
                    <div className="col-span-4 text-right text-base font-semibold text-destructive">
                      總欠款 ${summary.totalOutstanding.toLocaleString()}
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.orders.map((order) => (
                          <TableRow key={order.id}>
                            <TableCell className="font-medium">{order.orderNumber}</TableCell>
                            <TableCell>
                              {order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}
                            </TableCell>
                            <TableCell>{order.products}</TableCell>
                            <TableCell className="text-right">${order.amountDue.toLocaleString()}</TableCell>
                            <TableCell className="text-right">${order.outstanding.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/40">
                          <TableCell colSpan={3} className="text-right font-semibold">總金額</TableCell>
                          <TableCell className="text-right font-semibold">
                            ${summary.orders.reduce((sum, order) => sum + order.amountDue, 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-destructive">
                            ${summary.orders.reduce((sum, order) => sum + order.outstanding, 0).toLocaleString()}
                          </TableCell>
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
    </div>
  )
}
