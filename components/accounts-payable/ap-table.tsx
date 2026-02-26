"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Eye, EyeOff, Search } from "lucide-react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { AccountsPayable } from "@/lib/types"

interface APTableProps {
  records: AccountsPayable[]
}

export function APTable({ records }: APTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [isPrivacyMode, setIsPrivacyMode] = useState(true)
  const [showAllSuppliers, setShowAllSuppliers] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [processingSupplierKey, setProcessingSupplierKey] = useState<string | null>(null)

  const filteredRecords = records.filter(
    (record) =>
      record.supplier?.name?.toLowerCase().includes(search.toLowerCase()) ||
      record.purchase_order?.order_no?.toLowerCase().includes(search.toLowerCase()),
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

  const supplierSummaryMap = filteredRecords.reduce((map, record) => {
    const supplierId = record.supplier_id || "未指定"
    const supplierName = record.supplier?.name || "未指定供應商"
    const key = `${supplierId}-${supplierName}`
    const outstanding = record.amount_due - record.paid_amount
    const current = map.get(key)

    const orderData = {
      id: record.id,
      purchaseOrderId: record.purchase_order_id,
      orderNumber: record.purchase_order?.order_no || "-",
      orderDate: record.purchase_order?.order_date || record.due_date || null,
      products:
        record.purchase_order?.items
          ?.map((item) => item.product?.name || item.code || "-")
          .filter(Boolean)
          .join("、") || "-",
      amountDue: record.amount_due,
      paidAmount: record.paid_amount,
      outstanding,
    }

    if (current) {
      current.totalDue += record.amount_due
      current.totalPaid += record.paid_amount
      current.totalOutstanding += outstanding
      current.orderCount += 1
      current.orders.push(orderData)
    } else {
      map.set(key, {
        supplierName,
        supplierId,
        totalDue: record.amount_due,
        totalPaid: record.paid_amount,
        totalOutstanding: outstanding,
        orderCount: 1,
        orders: [orderData],
      })
    }

    return map
  }, new Map<string, {
    supplierName: string
    supplierId: string
    totalDue: number
    totalPaid: number
    totalOutstanding: number
    orderCount: number
    orders: Array<{
      id: string
      purchaseOrderId: string | null
      orderNumber: string
      orderDate: string | null
      products: string
      amountDue: number
      paidAmount: number
      outstanding: number
    }>
  }>())

  const supplierSummaries = Array.from(supplierSummaryMap.values())
    .filter((summary) => showAllSuppliers || summary.totalOutstanding > 0)
    .sort((a, b) => {
      if (a.supplierId === "未指定" && b.supplierId !== "未指定") return 1
      if (a.supplierId !== "未指定" && b.supplierId === "未指定") return -1
      return a.supplierId.localeCompare(b.supplierId, "zh-Hant", {
        numeric: true,
        sensitivity: "base",
      })
    })

  const handleBatchSettle = (summary: (typeof supplierSummaries)[number]) => {
    const supplierKey = `${summary.supplierId}-${summary.supplierName}`
    setProcessingSupplierKey(supplierKey)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const unpaidOrders = summary.orders.filter((order) => order.outstanding > 0)

        if (unpaidOrders.length === 0) {
          toast({ title: "提示", description: "此供應商目前沒有未付款單據" })
          return
        }

        const purchaseOrderIds = unpaidOrders
          .map((order) => order.purchaseOrderId)
          .filter((id): id is string => Boolean(id))

        if (purchaseOrderIds.length > 0) {
          const { error: purchaseUpdateError } = await supabase
            .from("purchase_orders")
            .update({ is_paid: true })
            .in("id", purchaseOrderIds)

          if (purchaseUpdateError) {
            toast({
              title: "錯誤",
              description: purchaseUpdateError.message || "無法更新進貨付款狀態",
              variant: "destructive",
            })
            return
          }
        }

        for (const order of unpaidOrders) {
          if (!order.purchaseOrderId) continue

          if (order.id.startsWith("virtual-")) {
            const { error: insertError } = await supabase.from("accounts_payable").insert({
              purchase_order_id: order.purchaseOrderId,
              supplier_id: summary.supplierId === "未指定" ? null : summary.supplierId,
              amount_due: order.amountDue,
              total_amount: order.amountDue,
              paid_amount: order.amountDue,
              due_date: order.orderDate,
              status: "paid",
            })

            if (insertError) {
              toast({
                title: "錯誤",
                description: insertError.message || "無法建立應付帳款資料",
                variant: "destructive",
              })
              return
            }
          } else {
            const { error: updateError } = await supabase
              .from("accounts_payable")
              .update({ paid_amount: order.amountDue, status: "paid", total_amount: order.amountDue })
              .eq("id", order.id)

            if (updateError) {
              toast({
                title: "錯誤",
                description: updateError.message || "無法更新應付帳款資料",
                variant: "destructive",
              })
              return
            }
          }
        }

        toast({ title: "成功", description: `已完成 ${summary.supplierName} 的一鍵沖帳` })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setProcessingSupplierKey(null)
      }
    })
  }

  const handleExportStatement = (summary: (typeof supplierSummaries)[number]) => {
    const outstandingOrders = summary.orders.filter((order) => order.outstanding > 0)

    if (outstandingOrders.length === 0) {
      toast({ title: "提示", description: "此供應商目前沒有未付款資料可匯出" })
      return
    }

    const headers = ["供應商名稱", "供應商代號", "進貨單號", "日期", "商品", "單筆金額", "已付金額", "未付金額"]
    const lines = outstandingOrders.map((order) => {
      const dateText = order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"
      return [
        summary.supplierName,
        summary.supplierId,
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
    link.download = `${summary.supplierName}-對帳單-${dateStamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    toast({ title: "成功", description: "已匯出對帳單" })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋供應商、單號..."
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
          <Button variant={showAllSuppliers ? "outline" : "default"} size="sm" onClick={() => setShowAllSuppliers(false)}>
            只看欠款供應商
          </Button>
          <Button variant={showAllSuppliers ? "default" : "outline"} size="sm" onClick={() => setShowAllSuppliers(true)}>
            顯示全部供應商
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應付合計</p>
          <p className="text-2xl font-semibold">{renderAmount(totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">已付金額</p>
          <p className="text-2xl font-semibold">{renderAmount(paidAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應付未付</p>
          <p className="text-2xl font-semibold text-destructive">
            {isPrivacyMode ? <span className="text-muted-foreground tracking-widest">****</span> : `$${outstandingAmount.toLocaleString()}`}
          </p>
        </div>
      </div>

      <div className="rounded-lg border">
        {supplierSummaries.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {search ? "找不到符合的供應商歸戶資料" : showAllSuppliers ? "尚無供應商歸戶資料" : "目前沒有欠款供應商"}
          </div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {supplierSummaries.map((summary) => {
              const summaryKey = `${summary.supplierId}-${summary.supplierName}`
              return (
                <AccordionItem key={summaryKey} value={summaryKey}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                      <div className="col-span-4">
                        <p className="font-medium">{summary.supplierName}</p>
                        <p className="text-xs text-muted-foreground">{summary.supplierId}・{summary.orderCount} 筆單據</p>
                      </div>
                      <div className="col-span-4 text-right text-sm text-muted-foreground">應付合計 {renderAmount(summary.totalDue)}</div>
                      <div className="col-span-4 text-right text-base font-semibold text-destructive">總欠款 {renderAmount(summary.totalOutstanding)}</div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <div className="mb-3 flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportStatement(summary)}
                        disabled={isPending && processingSupplierKey === summaryKey}
                      >
                        匯出對帳單
                      </Button>
                      <Button size="sm" onClick={() => handleBatchSettle(summary)} disabled={isPending && processingSupplierKey === summaryKey}>
                        {isPending && processingSupplierKey === summaryKey ? "處理中..." : "一鍵沖帳"}
                      </Button>
                    </div>

                    <div className="rounded-md border">
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
                          {summary.orders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell className="font-medium">{order.orderNumber}</TableCell>
                              <TableCell>{order.orderDate ? new Date(order.orderDate).toLocaleDateString("zh-TW") : "-"}</TableCell>
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
              )
            })}
          </Accordion>
        )}
      </div>
    </div>
  )
}
