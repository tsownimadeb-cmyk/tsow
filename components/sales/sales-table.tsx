"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Search, Check, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { SalesOrder, Customer, Product } from "@/lib/types"

interface SalesTableProps {
  sales: SalesOrder[]
  customers: Customer[]
  products: Product[]
}

export function SalesTable({ sales, customers, products }: SalesTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [isPending, startTransition] = useTransition()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingSaleId, setDeletingSaleId] = useState<string | null>(null)

  const customerMap = new Map(
    customers.flatMap((customer) => [
      [customer.code, customer] as const,
      [customer.cno || customer.code, customer] as const,
    ]),
  )
  const productMap = new Map(products.map((product) => [product.code, product]))

  const searchText = search.toLowerCase()
  const filteredSales = sales.filter((sale) => {
    const orderNumber = (sale.order_no || "").toLowerCase()
    const customerName = (customerMap.get(sale.customer_cno || "")?.name || "").toLowerCase()
    return orderNumber.includes(searchText) || customerName.includes(searchText)
  })

  const handleTogglePaid = (sale: SalesOrder) => {
    const saleId = sale.id
    const currentStatus = Boolean(sale.is_paid)
    const newStatus = !currentStatus
    setUpdatingId(saleId)

    startTransition(async () => {
      try {
        const supabase = createClient()

        const { error } = await supabase.from("sales_orders").update({ is_paid: newStatus }).eq("id", saleId)

        if (error) {
          toast({ title: "錯誤", description: error.message || "無法更新付款狀態", variant: "destructive" })
          return
        }

        const { data: existingArRows, error: arQueryError } = await supabase
          .from("accounts_receivable")
          .select("id")
          .eq("sales_order_id", saleId)
          .limit(1)

        if (arQueryError) {
          toast({ title: "錯誤", description: arQueryError.message || "無法查詢應收帳款", variant: "destructive" })
          return
        }

        const arPayload = {
          customer_cno: sale.customer_cno,
          amount_due: Number(sale.total_amount),
          total_amount: Number(sale.total_amount),
          paid_amount: newStatus ? Number(sale.total_amount) : 0,
          due_date: sale.order_date,
          status: newStatus ? "paid" : "unpaid",
        }

        if (existingArRows && existingArRows.length > 0) {
          const { error: arUpdateError } = await supabase
            .from("accounts_receivable")
            .update(arPayload)
            .eq("id", existingArRows[0].id)

          if (arUpdateError) {
            toast({ title: "錯誤", description: arUpdateError.message || "無法更新應收帳款", variant: "destructive" })
            return
          }
        } else {
          const { error: arInsertError } = await supabase
            .from("accounts_receivable")
            .insert({ sales_order_id: saleId, ...arPayload })

          if (arInsertError) {
            toast({ title: "錯誤", description: arInsertError.message || "無法建立應收帳款", variant: "destructive" })
            return
          }
        }

        toast({ title: "成功", description: newStatus ? "已標記為已付款" : "已標記為未付款" })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      } finally {
        setUpdatingId(null)
      }
    })
  }

  const handleDeleteSale = async (sale: SalesOrder) => {
    if (!window.confirm("確定要刪除此筆單據及其所有明細嗎？")) {
      return
    }

    const saleId = String(sale.id ?? "").trim()
    if (!saleId) {
      toast({ title: "錯誤", description: "找不到主鍵 id，無法刪除", variant: "destructive" })
      return
    }

    try {
      setDeletingSaleId(saleId)
      const supabase = createClient()

      const quantityByCode = new Map<string, number>()
      for (const item of sale.sales_order_items || []) {
        const code = String(item.code || "").trim()
        const quantity = Number(item.quantity ?? 0)
        if (!code || !Number.isFinite(quantity) || quantity <= 0) continue
        quantityByCode.set(code, (quantityByCode.get(code) || 0) + quantity)
      }

      await Promise.all(
        Array.from(quantityByCode.entries()).map(async ([code, quantity]) => {
          const { data: product, error: productError } = await supabase
            .from("products")
            .select("code,stock_qty")
            .eq("code", code)
            .single()

          if (productError || !product) {
            throw new Error(productError?.message || `找不到商品 ${code}`)
          }

          const coalescedStockQty = Number(product.stock_qty ?? 0)
          const { error: updateInventoryError } = await supabase
            .from("products")
            .update({ stock_qty: coalescedStockQty + quantity })
            .eq("code", code)

          if (updateInventoryError) {
            throw new Error(updateInventoryError.message)
          }
        }),
      )

      const { error: detailError } = await supabase.from("sales_order_items").delete().eq("sales_order_id", saleId)
      if (detailError) {
        toast({
          title: "錯誤",
          description: `刪除銷貨明細失敗（sales_order_items.sales_order_id）：${detailError.message}`,
          variant: "destructive",
        })
        return
      }

      const { error: headerError } = await supabase.from("sales_orders").delete().eq("id", saleId)
      if (headerError) {
        toast({
          title: "錯誤",
          description: `刪除銷貨單頭失敗（sales_orders.id）：${headerError.message}`,
          variant: "destructive",
        })
        return
      }

      window.location.reload()
    } catch (error) {
      toast({
        title: "錯誤",
        description: error instanceof Error ? `刪除銷貨單失敗：${error.message}` : "刪除銷貨單失敗",
        variant: "destructive",
      })
    } finally {
      setDeletingSaleId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋單號或客戶..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="rounded-lg border">
        {filteredSales.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">{search ? "找不到符合的銷貨單" : "尚無銷貨單資料"}</div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {filteredSales.map((sale) => {
              const customerName = customerMap.get(sale.customer_cno || "")?.name || "-"
              return (
                <AccordionItem key={sale.id} value={sale.id}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                      <div className="col-span-3">
                        <p className="font-medium">{sale.order_no}</p>
                        <p className="text-xs text-muted-foreground">{customerName}</p>
                      </div>
                      <div className="col-span-2 text-sm">{new Date(sale.order_date).toLocaleDateString("zh-TW")}</div>
                      <div className="col-span-3 text-right text-sm font-medium">${Number(sale.total_amount).toLocaleString()}</div>
                      <div className="col-span-4 flex justify-end pr-2">
                        {sale.is_paid ? (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" />已付款
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <X className="h-3 w-3" />未付款
                          </Badge>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <div className="mb-3 flex justify-end">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTogglePaid(sale)}
                          disabled={isPending && updatingId === sale.id}
                          className="h-8 px-2"
                        >
                          {sale.is_paid ? "標記為未付款" : "標記為已付款"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteSale(sale)}
                          disabled={deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim()}
                          className="h-8 px-2"
                        >
                          {deletingSaleId === String(sale.id ?? sale.order_no ?? "").trim() ? "刪除中..." : "刪除"}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>商品名稱</TableHead>
                            <TableHead className="text-right">數量</TableHead>
                            <TableHead className="text-right">單價</TableHead>
                            <TableHead className="text-right">小計</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sale.sales_order_items && sale.sales_order_items.length > 0 ? (
                            sale.sales_order_items.map((item) => {
                              const itemCode = item.code || null
                              const productName = item.product?.name || (itemCode ? productMap.get(itemCode)?.name || itemCode : "-")
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>{productName}</TableCell>
                                  <TableCell className="text-right">{item.quantity}</TableCell>
                                  <TableCell className="text-right">${Number(item.unit_price).toLocaleString()}</TableCell>
                                  <TableCell className="text-right">${Number(item.subtotal).toLocaleString()}</TableCell>
                                </TableRow>
                              )
                            })
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                                無商品明細
                              </TableCell>
                            </TableRow>
                          )}
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
