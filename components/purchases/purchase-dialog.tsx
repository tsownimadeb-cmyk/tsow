"use client"

import type React from "react"
import { useState, useTransition } from "react"
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
import { useToast } from "@/hooks/use-toast"
import type { Supplier, Product } from "@/lib/types"

interface PurchaseDialogProps {
  suppliers: Supplier[]
  products: Product[]
  mode: "create"
  children?: React.ReactNode
}

interface OrderItem {
  code: string
  quantity: number
  unit_price: number
}

export function PurchaseDialog({ suppliers, products, mode, children }: PurchaseDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const [formData, setFormData] = useState({
    supplier_id: "",
    order_date: new Date().toISOString().split("T")[0],
    notes: "",
    shipping_fee: 0,
    is_paid: false,
  })

  const [items, setItems] = useState<OrderItem[]>([])

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
        unit_price: product ? Number(product.cost) : 0,
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value }
    }
    setItems(newItems)
  }

  const totalGoodsAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const shippingFee = Number(formData.shipping_fee ?? 0)
  const totalAmount = totalGoodsAmount + shippingFee

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

        const orderNo = generateOrderNumber()

        const { data: order, error: orderError } = await supabase
          .from("purchase_orders")
          .insert({
            order_no: orderNo,
            supplier_id: formData.supplier_id || null,
            order_date: formData.order_date,
            total_amount: totalAmount,
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
              total_amount: totalAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: formData.notes || null,
            })
            .select()
            .single()

          if (!fallbackOrder.error && fallbackOrder.data) {
            const fallbackCreatedOrder = fallbackOrder.data
            const orderItemsByOrderNo = items.map((item) => ({
              order_no: orderNo,
              code: item.code || null,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.quantity * item.unit_price,
            }))

            let itemsInsertError: any = null

            const insertByOrderNo = await supabase.from("purchase_order_items").insert(orderItemsByOrderNo)
            if (insertByOrderNo.error) {
              itemsInsertError = insertByOrderNo.error

              const orderItemsByPurchaseId = items.map((item) => ({
                purchase_order_id: fallbackCreatedOrder.id,
                code: item.code || null,
                quantity: item.quantity,
                unit_price: item.unit_price,
                subtotal: item.quantity * item.unit_price,
              }))

              const insertByPurchaseId = await supabase.from("purchase_order_items").insert(orderItemsByPurchaseId)
              if (insertByPurchaseId.error) {
                itemsInsertError = insertByPurchaseId.error

                const orderItemsLegacy = items.map((item) => ({
                  purchase_order_id: fallbackCreatedOrder.id,
                  product_pno: item.code || null,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  subtotal: item.quantity * item.unit_price,
                }))

                const insertLegacy = await supabase.from("purchase_order_items").insert(orderItemsLegacy)
                if (insertLegacy.error) {
                  itemsInsertError = insertLegacy.error
                } else {
                  itemsInsertError = null
                }
              } else {
                itemsInsertError = null
              }
            }

            if (itemsInsertError) {
              const message = itemsInsertError.message || "無法新增進貨明細，請稍後再試"
              console.error("[PurchaseDialog] 新增進貨明細失敗:", itemsInsertError)
              toastApi.error(message)
              return
            }

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

            const { error: apError } = await supabase.from("accounts_payable").insert({
              purchase_order_id: fallbackCreatedOrder.id,
              supplier_id: fallbackCreatedOrder.supplier_id,
              amount_due: Number(fallbackCreatedOrder.total_amount),
              total_amount: Number(fallbackCreatedOrder.total_amount),
              paid_amount: formData.is_paid ? Number(fallbackCreatedOrder.total_amount) : 0,
              due_date: fallbackCreatedOrder.order_date,
              status: formData.is_paid ? "paid" : "unpaid",
            })

            if (apError) {
              console.error("[PurchaseDialog] 同步應付帳款失敗:", apError)
              toastApi.error(apError.message)
            }

            toast({
              title: "成功",
              description: "進貨單建立成功",
            })

            setOpen(false)
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

        const orderItemsByOrderNo = items.map((item) => ({
          order_no: orderNo,
          code: item.code || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.quantity * item.unit_price,
        }))

        let itemsInsertError: any = null

        const insertByOrderNo = await supabase.from("purchase_order_items").insert(orderItemsByOrderNo)
        if (insertByOrderNo.error) {
          itemsInsertError = insertByOrderNo.error

          const orderItemsByPurchaseId = items.map((item) => ({
            purchase_order_id: order.id,
            code: item.code || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price,
          }))

          const insertByPurchaseId = await supabase.from("purchase_order_items").insert(orderItemsByPurchaseId)
          if (insertByPurchaseId.error) {
            itemsInsertError = insertByPurchaseId.error

            const orderItemsLegacy = items.map((item) => ({
              purchase_order_id: order.id,
              product_pno: item.code || null,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.quantity * item.unit_price,
            }))

            const insertLegacy = await supabase.from("purchase_order_items").insert(orderItemsLegacy)
            if (insertLegacy.error) {
              itemsInsertError = insertLegacy.error
            } else {
              itemsInsertError = null
            }
          } else {
            itemsInsertError = null
          }
        }

        if (itemsInsertError) {
          const message = itemsInsertError.message || "無法新增進貨明細，請稍後再試"
          console.error("[PurchaseDialog] 新增進貨明細失敗:", itemsInsertError)
          toastApi.error(message)
          return
        }

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

        const { error: apError } = await supabase.from("accounts_payable").insert({
          purchase_order_id: order.id,
          supplier_id: order.supplier_id,
          amount_due: Number(order.total_amount),
          total_amount: Number(order.total_amount),
          paid_amount: formData.is_paid ? Number(order.total_amount) : 0,
          due_date: order.order_date,
          status: formData.is_paid ? "paid" : "unpaid",
        })

        if (apError) {
          console.error("[PurchaseDialog] 同步應付帳款失敗:", apError)
          toastApi.error(apError.message)
        }

        toast({
          title: "成功",
          description: "進貨單建立成功",
        })

        setOpen(false)
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增進貨單</DialogTitle>
          <DialogDescription>填寫進貨單資料與明細</DialogDescription>
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
            <Label htmlFor="notes">備註</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
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
            <Label htmlFor="is_paid" className="text-sm font-medium cursor-pointer">已付款</Label>
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
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value) || 1)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => updateItem(index, "unit_price", Number.parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          ${(item.quantity * item.unit_price).toLocaleString()}
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
              <div className="text-sm text-muted-foreground">商品總額：${totalGoodsAmount.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">運費：${shippingFee.toLocaleString()}</div>
              <div className="text-lg font-semibold">總計：${totalAmount.toLocaleString()}</div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || items.length === 0}>
              {isPending ? "儲存中..." : "建立進貨單"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
