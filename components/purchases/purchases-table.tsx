"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Search, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { PurchaseOrder, Supplier, Product } from "@/lib/types"

interface PurchasesTableProps {
  purchases: PurchaseOrder[]
  suppliers: Supplier[]
  products: Product[]
}

export function PurchasesTable({ purchases, suppliers, products }: PurchasesTableProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [isPending, startTransition] = useTransition()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null)

  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]))
  const productMap = new Map(products.map((product) => [product.code, product]))

  const searchText = search.toLowerCase()
  const filteredPurchases = purchases.filter((purchase) => {
    const orderNumber = (purchase.order_no || "").toLowerCase()
    const supplierName = (supplierMap.get(purchase.supplier_id || "")?.name || "").toLowerCase()
    return orderNumber.includes(searchText) || supplierName.includes(searchText)
  })

  const handleTogglePaid = (purchase: PurchaseOrder) => {
    const purchaseId = purchase.id
    const currentStatus = Boolean(purchase.is_paid)
    const newStatus = !currentStatus
    setUpdatingId(purchaseId)

    startTransition(async () => {
      try {
        const supabase = createClient()

        const { error: purchaseError } = await supabase
          .from("purchase_orders")
          .update({ is_paid: newStatus })
          .eq("id", purchaseId)

        if (purchaseError) {
          toast({
            title: "錯誤",
            description: purchaseError.message || "無法更新進貨付款狀態",
            variant: "destructive",
          })
          return
        }

        const { data: existingApRows, error: apQueryError } = await supabase
          .from("accounts_payable")
          .select("id")
          .eq("purchase_order_id", purchaseId)
          .limit(1)

        if (apQueryError) {
          toast({
            title: "錯誤",
            description: apQueryError.message || "無法查詢應付帳款",
            variant: "destructive",
          })
          return
        }

        const apPayload = {
          supplier_id: purchase.supplier_id,
          amount_due: Number(purchase.total_amount),
          total_amount: Number(purchase.total_amount),
          paid_amount: newStatus ? Number(purchase.total_amount) : 0,
          due_date: purchase.order_date,
          status: newStatus ? "paid" : "unpaid",
        }

        if (existingApRows && existingApRows.length > 0) {
          const { error: apUpdateError } = await supabase
            .from("accounts_payable")
            .update(apPayload)
            .eq("id", existingApRows[0].id)

          if (apUpdateError) {
            toast({
              title: "錯誤",
              description: apUpdateError.message || "無法更新應付帳款",
              variant: "destructive",
            })
            return
          }
        } else {
          const { error: apInsertError } = await supabase.from("accounts_payable").insert({
            purchase_order_id: purchaseId,
            ...apPayload,
          })

          if (apInsertError) {
            toast({
              title: "錯誤",
              description: apInsertError.message || "無法建立應付帳款",
              variant: "destructive",
            })
            return
          }
        }

        toast({
          title: "成功",
          description: newStatus ? "已標記為已付款" : "已標記為未付款",
        })
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

  const handleDeletePurchase = async (purchase: PurchaseOrder) => {
    if (!window.confirm("確定要刪除此筆單據及其所有明細嗎？")) {
      return
    }

    const normalizedPurchaseId = String(purchase.id ?? "").trim()
    const normalizedOrderNo = String(purchase.order_no ?? "").trim()
    if (!normalizedPurchaseId) {
      toast({ title: "錯誤", description: "找不到進貨單 id，無法刪除", variant: "destructive" })
      return
    }

    try {
      setDeletingPurchaseId(normalizedPurchaseId)
      const supabase = createClient()

      const quantityByCode = new Map<string, number>()
      for (const item of purchase.items || []) {
        const code = String((item as any).code ?? "").trim()
        const quantity = Number(item.quantity ?? 0)
        if (!code || !Number.isFinite(quantity) || quantity <= 0) continue
        quantityByCode.set(code, (quantityByCode.get(code) || 0) + quantity)
      }

      await Promise.all(
        Array.from(quantityByCode.entries()).map(async ([code, quantity]) => {
          const { data: product, error: productError } = await supabase
            .from("products")
            .select("code,stock_qty,purchase_qty_total")
            .eq("code", code)
            .single()

          if (productError || !product) {
            throw new Error(productError?.message || `找不到商品 ${code}`)
          }

          const coalescedStockQty = Number(product.stock_qty ?? 0)
          const coalescedPurchaseTotal = Number(product.purchase_qty_total ?? 0)

          const { error: updateInventoryError } = await supabase
            .from("products")
            .update({
              stock_qty: Math.max(0, coalescedStockQty - quantity),
              purchase_qty_total: Math.max(0, coalescedPurchaseTotal - quantity),
            })
            .eq("code", code)

          if (updateInventoryError) {
            throw new Error(updateInventoryError.message)
          }
        }),
      )

      let detailErrorMessage: string | null = null

      if (normalizedOrderNo) {
        const { error: detailByOrderNoError } = await supabase
          .from("purchase_order_items")
          .delete()
          .eq("order_no", normalizedOrderNo)

        if (detailByOrderNoError) {
          detailErrorMessage = `order_no 刪除失敗：${detailByOrderNoError.message}`
        }
      }

      if (!normalizedOrderNo || detailErrorMessage) {
        const { error: detailByPurchaseIdError } = await supabase
          .from("purchase_order_items")
          .delete()
          .eq("purchase_order_id", normalizedPurchaseId)

        if (detailByPurchaseIdError) {
          const fallbackMessage = `purchase_order_id 刪除失敗：${detailByPurchaseIdError.message}`
          const message = detailErrorMessage ? `${detailErrorMessage}；${fallbackMessage}` : fallbackMessage
          toast({
            title: "錯誤",
            description: `刪除進貨明細失敗：${message}`,
            variant: "destructive",
          })
          return
        }
      }

      const { error: headerError } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("id", normalizedPurchaseId)

      if (headerError) {
        toast({
          title: "錯誤",
          description: `刪除進貨單頭失敗（purchase_orders.id）：${headerError.message}`,
          variant: "destructive",
        })
        return
      }

      window.location.reload()
    } catch (error) {
      toast({
        title: "錯誤",
        description: error instanceof Error ? `刪除進貨單失敗：${error.message}` : "刪除進貨單失敗",
        variant: "destructive",
      })
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋單號或供應商..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="rounded-lg border">
        {filteredPurchases.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">{search ? "找不到符合的進貨單" : "尚無進貨單資料"}</div>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {filteredPurchases.map((purchase) => {
              const supplierName = supplierMap.get(purchase.supplier_id || "")?.name || "-"
              return (
                <AccordionItem key={purchase.id} value={purchase.id}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="grid w-full grid-cols-12 items-center gap-2 text-left">
                      <div className="col-span-3">
                        <p className="font-medium">{purchase.order_no || "-"}</p>
                        <p className="text-xs text-muted-foreground">{supplierName}</p>
                      </div>
                      <div className="col-span-2 text-sm">{new Date(purchase.order_date).toLocaleDateString("zh-TW")}</div>
                      <div className="col-span-3 text-right text-sm font-medium">${Number(purchase.total_amount).toLocaleString()}</div>
                      <div className="col-span-4 flex justify-end pr-2">
                        {purchase.is_paid ? (
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
                          onClick={() => handleTogglePaid(purchase)}
                          disabled={isPending && updatingId === purchase.id}
                          className="h-8 px-2"
                        >
                          {purchase.is_paid ? "標記為未付款" : "標記為已付款"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeletePurchase(purchase)}
                          disabled={deletingPurchaseId === purchase.id}
                          className="h-8 px-2"
                        >
                          {deletingPurchaseId === purchase.id ? "刪除中..." : "刪除"}
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
                          {purchase.items && purchase.items.length > 0 ? (
                            purchase.items.map((item) => {
                              const itemCode = (item as any).code || null
                              const productName = item.product?.name || (itemCode
                                ? productMap.get(itemCode)?.name || itemCode
                                : "-")
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
