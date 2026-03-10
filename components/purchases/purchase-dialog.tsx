"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { recalculateProductCostsByCodes } from "@/lib/product-cost-recalculation"
import { useToast } from "@/hooks/use-toast"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import type { Supplier, Product, PurchaseOrder } from "@/lib/types"

interface PurchaseDialogProps {
  suppliers: Supplier[]
  products: Product[]
  mode: "create" | "edit"
  purchase?: PurchaseOrder
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface OrderItem {
  code: string
  quantity: number
  unit_price: number
}

export function PurchaseDialog({ suppliers, products, mode, purchase, children, open, onOpenChange }: PurchaseDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const getInitialFormData = () => ({
    supplier_id: purchase?.supplier_id || "",
    order_date: purchase?.order_date || new Date().toISOString().split("T")[0],
    notes: purchase?.notes || "",
    shipping_fee: Number(purchase?.shipping_fee ?? 0),
    is_paid: Boolean(purchase?.is_paid),
  })

  const getInitialItems = (): OrderItem[] => {
    if (!purchase?.items || purchase.items.length === 0) return []
    return purchase.items
      .map((item) => ({
        code: String(item.code || "").trim(),
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
      }))
      .filter((item) => item.code && item.quantity > 0)
  }

  const [formData, setFormData] = useState(getInitialFormData)
  const [items, setItems] = useState<OrderItem[]>(getInitialItems)

  useEffect(() => {
    if (mode === "edit") {
      setFormData(getInitialFormData())
      setItems(getInitialItems())
      return
    }

    if (!isOpen) {
      setFormData(getInitialFormData())
      setItems([])
    }
  }, [mode, purchase, isOpen])

  const toastApi = {
    error: (message: string) => {
      toast({
        title: "錯誤",
        description: message,
        variant: "destructive",
      })
    },
  }

  const generateOrderNumber = () => {
    const date = new Date()
    const prefix = "PO"
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")
    return `${prefix}${dateStr}${random}`
  }

  const addItem = () => {
    setItems([...items, { code: "", quantity: 1, unit_price: 0 }])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    const newItems = [...items]
    if (field === "code") {
      const product = products.find((p) => p.code === value)
      newItems[index] = {
        ...newItems[index],
        code: value as string,
        unit_price: product ? Number(product.base_price ?? product.purchase_price ?? product.cost ?? 0) : 0,
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value }
    }
    setItems(newItems)
  }

  const totalGoodsAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const shippingFee = Math.max(0, Number(formData.shipping_fee ?? 0))
  const landedTotalAmount = totalGoodsAmount + shippingFee

  const syncAccountsPayable = async (
    purchaseOrderId: string,
    supplierId: string | null,
    amount: number,
    dueDate: string,
    paid: boolean,
  ) => {
    const supabase = createClient()

    const { data: existingApRows, error: apQueryError } = await supabase
      .from("accounts_payable")
      .select("id")
      .eq("purchase_order_id", purchaseOrderId)
      .limit(1)

    if (apQueryError) {
      throw new Error(apQueryError.message || "無法查詢應付帳款")
    }

    const apPayload = {
      supplier_id: supplierId,
      amount_due: amount,
      total_amount: amount,
      paid_amount: paid ? amount : 0,
      due_date: dueDate,
      status: paid ? "paid" : "unpaid",
    }

    if (existingApRows && existingApRows.length > 0) {
      const { error: apUpdateError } = await supabase
        .from("accounts_payable")
        .update(apPayload)
        .eq("id", existingApRows[0].id)

      if (apUpdateError) {
        throw new Error(apUpdateError.message || "無法更新應付帳款")
      }
      return
    }

    const { error: apInsertError } = await supabase.from("accounts_payable").insert({
      purchase_order_id: purchaseOrderId,
      ...apPayload,
    })

    if (apInsertError) {
      throw new Error(apInsertError.message || "無法建立應付帳款")
    }
  }

  const insertPurchaseItems = async (
    purchaseId: string,
    orderNo: string,
    orderItems: OrderItem[],
    supabase: ReturnType<typeof createClient>,
  ) => {
    const payload = orderItems.map((item) => ({
      purchase_order_id: purchaseId,
      order_no: orderNo,
      code: item.code || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.quantity * item.unit_price,
    }))

    const { error } = await supabase.from("purchase_order_items").insert(payload)
    if (error) {
      throw new Error(error.message || "無法新增進貨明細，請稍後再試")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (items.length === 0) {
      toastApi.error("請至少新增一筆進貨明細")
      return
    }

    const supabase = createClient()

    startTransition(async () => {
      try {
        const quantityByCode = new Map<string, number>()
        const amountByCode = new Map<string, number>()
        for (const item of items) {
          const code = String(item.code || "").trim()
          const quantity = Number(item.quantity)
          const unitPrice = Number(item.unit_price ?? 0)

          if (!code) {
            toastApi.error("進貨明細缺少商品編號(code)")
            return
          }

          if (!Number.isFinite(quantity) || quantity <= 0) {
            toastApi.error(`商品 ${code} 的數量無效，請輸入大於 0 的數字`)
            return
          }

          quantityByCode.set(code, (quantityByCode.get(code) || 0) + quantity)
          amountByCode.set(code, (amountByCode.get(code) || 0) + quantity * unitPrice)
        }

        if (mode === "edit") {
          const purchaseId = String(purchase?.id || "").trim()
          const orderNo = String(purchase?.order_no || "").trim()

          if (!purchaseId) {
            toastApi.error("找不到進貨單 id，無法更新")
            return
          }
          if (!orderNo) {
            toastApi.error("找不到進貨單號，無法更新")
            return
          }

          const headerPayload = {
            supplier_id: formData.supplier_id || null,
            order_date: formData.order_date,
            total_amount: totalGoodsAmount,
            shipping_fee: shippingFee,
            status: "completed",
            is_paid: formData.is_paid,
            notes: formData.notes || null,
          }

          const updateWithShipping = await supabase.from("purchase_orders").update(headerPayload).eq("id", purchaseId)
          if (updateWithShipping.error) {
            const fallbackPayload = {
              supplier_id: formData.supplier_id || null,
              order_date: formData.order_date,
              total_amount: totalGoodsAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: formData.notes || null,
            }
            const updateFallback = await supabase.from("purchase_orders").update(fallbackPayload).eq("id", purchaseId)
            if (updateFallback.error) {
              toastApi.error(updateFallback.error.message || "無法更新進貨單")
              return
            }
          }

          const deleteByOrderNo = await supabase.from("purchase_order_items").delete().eq("order_no", orderNo)
          if (deleteByOrderNo.error) {
            const deleteByPurchaseId = await supabase
              .from("purchase_order_items")
              .delete()
              .eq("purchase_order_id", purchaseId)
            if (deleteByPurchaseId.error) {
              toastApi.error(deleteByPurchaseId.error.message || "無法更新進貨明細")
              return
            }
          }

          await insertPurchaseItems(purchaseId, orderNo, items, supabase)

          const oldQuantityByCode = new Map<string, number>()
          for (const oldItem of purchase?.items || []) {
            const code = String(oldItem.code || "").trim()
            const quantity = Number(oldItem.quantity || 0)
            if (!code || !Number.isFinite(quantity)) continue
            oldQuantityByCode.set(code, (oldQuantityByCode.get(code) || 0) + quantity)
          }

          const allCodes = new Set<string>([...Array.from(oldQuantityByCode.keys()), ...Array.from(quantityByCode.keys())])

          for (const code of allCodes) {
            const oldQty = Number(oldQuantityByCode.get(code) || 0)
            const newQty = Number(quantityByCode.get(code) || 0)
            const delta = newQty - oldQty
            const hasEditedPurchaseLine = quantityByCode.has(code)
            if (delta === 0 && !hasEditedPurchaseLine) continue

            const { data: product, error: productError } = await supabase
              .from("products")
              .select("code,stock_qty,purchase_qty_total,cost")
              .eq("code", code)
              .single()

            if (productError || !product) {
              throw new Error(productError?.message || `找不到商品 ${code}`)
            }

            const coalescedStockQty = Number(product.stock_qty ?? 0)
            const coalescedPurchaseQtyTotal = Number(product.purchase_qty_total ?? 0)
            const coalescedCurrentCost = Number(product.cost ?? 0)

            const nextStockQty = Math.max(0, coalescedStockQty + delta)
            const nextPurchaseQtyTotal = Math.max(0, coalescedPurchaseQtyTotal + delta)

            const updatePayload: Record<string, number> = {
              stock_qty: nextStockQty,
              purchase_qty_total: nextPurchaseQtyTotal,
            }

            if (hasEditedPurchaseLine) {
              const itemTotalAmount = Number(amountByCode.get(code) ?? 0)
              const allocatedShippingForItem = totalGoodsAmount > 0 ? (itemTotalAmount / totalGoodsAmount) * shippingFee : 0
              const allocatedShippingPerUnit = newQty > 0 ? allocatedShippingForItem / newQty : 0
              const baseUnitCost = newQty > 0 ? itemTotalAmount / newQty : coalescedCurrentCost
              const nextCost = baseUnitCost + allocatedShippingPerUnit
              updatePayload.cost = nextCost
            } else if (nextPurchaseQtyTotal <= 0) {
              updatePayload.cost = 0
            }

            const { error: updateInventoryError } = await supabase
              .from("products")
              .update(updatePayload)
              .eq("code", code)

            if (updateInventoryError) {
              throw new Error(updateInventoryError.message)
            }
          }

          await recalculateProductCostsByCodes(supabase, Array.from(allCodes))

          await syncAccountsPayable(
            purchaseId,
            formData.supplier_id || null,
            Number(totalGoodsAmount),
            formData.order_date,
            Boolean(formData.is_paid),
          )

          toast({
            title: "成功",
            description: "進貨單更新成功",
          })

          setIsOpen(false)
          router.refresh()
          return
        }

        const orderNo = generateOrderNumber()

        const { data: order, error: orderError } = await supabase
          .from("purchase_orders")
          .insert({
            order_no: orderNo,
            supplier_id: formData.supplier_id || null,
            order_date: formData.order_date,
            total_amount: totalGoodsAmount,
            shipping_fee: shippingFee,
            status: "completed",
            is_paid: formData.is_paid,
            notes: formData.notes || null,
          })
          .select()
          .single()

        if (orderError || !order) {
          const fallbackOrder = await supabase
            .from("purchase_orders")
            .insert({
              order_no: orderNo,
              supplier_id: formData.supplier_id || null,
              order_date: formData.order_date,
              total_amount: totalGoodsAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: formData.notes || null,
            })
            .select()
            .single()

          if (!fallbackOrder.error && fallbackOrder.data) {
            const fallbackCreatedOrder = fallbackOrder.data
            await insertPurchaseItems(fallbackCreatedOrder.id, orderNo, items, supabase)

            const inventoryItems = Array.from(quantityByCode.entries()).map(([code, quantity]) => ({ code, quantity }))

            await Promise.all(
              inventoryItems.map(async (item) => {
                console.log("正在處理單據:", orderNo, "商品:", item.code)
                console.log("準備更新庫存 - 商品:", item.code, "數量:", item.quantity)

                const { data: currentProduct, error: currentProductError } = await supabase
                  .from("products")
                  .select("code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock")
                  .eq("code", item.code)
                  .single()

                if (currentProductError || !currentProduct) {
                  const message = currentProductError?.message || `找不到商品 ${item.code}`
                  console.error("[PurchaseDialog] 讀取商品失敗:", currentProductError)
                  throw new Error(message)
                }

                const coalescedStockQty = Number(currentProduct.stock_qty ?? 0)
                const coalescedPurchaseQtyTotal = Number(currentProduct.purchase_qty_total ?? 0)
                const coalescedCurrentCost = Number(currentProduct.cost ?? 0)
                const itemTotalAmount = Number(amountByCode.get(item.code) ?? 0)
                const allocatedShippingForItem = totalGoodsAmount > 0 ? (itemTotalAmount / totalGoodsAmount) * shippingFee : 0
                const allocatedShippingPerUnit = item.quantity > 0 ? allocatedShippingForItem / item.quantity : 0
                const baseUnitCost = item.quantity > 0 ? itemTotalAmount / item.quantity : coalescedCurrentCost
                const nextCost = baseUnitCost + allocatedShippingPerUnit

                const { error: updateInventoryError } = await supabase
                  .from("products")
                  .update({
                    stock_qty: coalescedStockQty + item.quantity,
                    purchase_qty_total: coalescedPurchaseQtyTotal + item.quantity,
                    cost: nextCost,
                  })
                  .eq("code", item.code)

                if (updateInventoryError) {
                  console.error("[PurchaseDialog] 更新庫存失敗:", updateInventoryError)
                  throw new Error(`成本更新失敗：${updateInventoryError.message}`)
                }
              }),
            )

            await recalculateProductCostsByCodes(
              supabase,
              inventoryItems.map((item) => item.code),
            )

            await syncAccountsPayable(
              String(fallbackCreatedOrder.id),
              fallbackCreatedOrder.supplier_id,
              Number(fallbackCreatedOrder.total_amount),
              fallbackCreatedOrder.order_date,
              Boolean(formData.is_paid),
            )

            toast({
              title: "成功",
              description: "進貨單建立成功",
            })

            setIsOpen(false)
            setFormData({ supplier_id: "", order_date: new Date().toISOString().split("T")[0], notes: "", shipping_fee: 0, is_paid: false })
            setItems([])
            router.refresh()
            return
          }

          const message = orderError?.message || "無法建立進貨單，請稍後再試"
          console.error("[PurchaseDialog] 建立進貨單失敗:", orderError)
          toastApi.error(message)
          return
        }

        await insertPurchaseItems(order.id, orderNo, items, supabase)

        const inventoryItems = Array.from(quantityByCode.entries()).map(([code, quantity]) => ({ code, quantity }))

        await Promise.all(
          inventoryItems.map(async (item) => {
            console.log("正在處理單據:", orderNo, "商品:", item.code)
            console.log("準備更新庫存 - 商品:", item.code, "數量:", item.quantity)

            const { data: currentProduct, error: currentProductError } = await supabase
              .from("products")
              .select("code,name,spec,unit,category,cost,price,sale_price,stock_qty,purchase_qty_total,safety_stock")
              .eq("code", item.code)
              .single()

            if (currentProductError || !currentProduct) {
              const message = currentProductError?.message || `找不到商品 ${item.code}`
              console.error("[PurchaseDialog] 讀取商品失敗:", currentProductError)
              throw new Error(message)
            }

            const coalescedStockQty = Number(currentProduct.stock_qty ?? 0)
            const coalescedPurchaseQtyTotal = Number(currentProduct.purchase_qty_total ?? 0)
            const coalescedCurrentCost = Number(currentProduct.cost ?? 0)
            const itemTotalAmount = Number(amountByCode.get(item.code) ?? 0)
            const allocatedShippingForItem = totalGoodsAmount > 0 ? (itemTotalAmount / totalGoodsAmount) * shippingFee : 0
            const allocatedShippingPerUnit = item.quantity > 0 ? allocatedShippingForItem / item.quantity : 0
            const baseUnitCost = item.quantity > 0 ? itemTotalAmount / item.quantity : coalescedCurrentCost
            const nextCost = baseUnitCost + allocatedShippingPerUnit

            const { error: updateInventoryError } = await supabase
              .from("products")
              .update({
                stock_qty: coalescedStockQty + item.quantity,
                purchase_qty_total: coalescedPurchaseQtyTotal + item.quantity,
                cost: nextCost,
              })
              .eq("code", item.code)

            if (updateInventoryError) {
              console.error("[PurchaseDialog] 更新庫存失敗:", updateInventoryError)
              throw new Error(`成本更新失敗：${updateInventoryError.message}`)
            }
          }),
        )

        await recalculateProductCostsByCodes(
          supabase,
          inventoryItems.map((item) => item.code),
        )

        await syncAccountsPayable(
          String(order.id),
          order.supplier_id,
          Number(order.total_amount),
          order.order_date,
          Boolean(formData.is_paid),
        )

        toast({
          title: "成功",
          description: "進貨單建立成功",
        })

        setIsOpen(false)
        setFormData({ supplier_id: "", order_date: new Date().toISOString().split("T")[0], notes: "", shipping_fee: 0, is_paid: false })
        setItems([])
        router.refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : "發生未知錯誤"
        console.error("[PurchaseDialog] 建立流程失敗:", message)
        toastApi.error(message)
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[1400px] sm:max-w-[1400px] max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增進貨單" : "編輯進貨單"}</DialogTitle>
          <DialogDescription>{mode === "create" ? "填寫進貨單資料與明細" : "修改已儲存的進貨單資料與明細"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">供應商</Label>
              <Select
                value={formData.supplier_id}
                onValueChange={(value) => setFormData({ ...formData, supplier_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇供應商" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="order_date">進貨日期</Label>
              <Input
                id="order_date"
                type="date"
                value={formData.order_date}
                onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shipping_fee">運費</Label>
            <Input
              id="shipping_fee"
              type="number"
              min="0"
              step="0.01"
              value={formData.shipping_fee}
              onChange={(e) => setFormData({ ...formData, shipping_fee: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_paid"
              checked={formData.is_paid}
              onCheckedChange={(checked) => setFormData({ ...formData, is_paid: Boolean(checked) })}
            />
            <Label htmlFor="is_paid" className="text-sm font-medium cursor-pointer">已付供應商貨款</Label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>進貨明細</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-4 w-4" />
                新增項目
              </Button>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>商品</TableHead>
                    <TableHead className="w-24">數量</TableHead>
                    <TableHead className="w-32">單價</TableHead>
                    <TableHead className="w-32 text-right">小計</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                        尚無項目，請點擊「新增項目」
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select value={item.code} onValueChange={(v) => updateItem(index, "code", v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="選擇商品" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.code} value={product.code}>
                                  {product.code} - {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            type="number"
                            min="1"
                            value={item.quantity}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value) || 1)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(index, "unit_price", Number.parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrencyOneDecimal(item.quantity * item.unit_price)}
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1 text-right">
              <div className="text-sm text-muted-foreground">商品總額（供應商貨款）：{formatCurrencyOneDecimal(totalGoodsAmount)}</div>
              <div className="text-sm text-muted-foreground">運費（另計）：{formatCurrencyOneDecimal(shippingFee)}</div>
              <div className="text-lg font-semibold">落地總成本：{formatCurrencyOneDecimal(landedTotalAmount)}</div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">備註</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || items.length === 0}>
              {isPending ? "儲存中..." : mode === "create" ? "建立進貨單" : "儲存變更"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
