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
import { useToast } from "@/hooks/use-toast"
import type { Customer, Product, SalesOrder } from "@/lib/types"

interface SalesDialogProps {
  customers: Customer[]
  products: Product[]
  mode: "create" | "edit"
  sales?: SalesOrder
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface OrderItem {
  code: string
  quantity: number
  unit_price: number
}

export function SalesDialog({ customers, products, mode, sales, children, open, onOpenChange }: SalesDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const getInitialFormData = () => ({
    order_no: sales?.order_no || "",
    customer_cno: sales?.customer_cno || "",
    order_date: sales?.order_date || new Date().toISOString().split("T")[0],
    notes: sales?.notes || "",
    is_paid: Boolean(sales?.is_paid),
  })

  const getInitialItems = (): OrderItem[] => {
    if (!sales?.sales_order_items || sales.sales_order_items.length === 0) return []
    return sales.sales_order_items
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
  }, [mode, sales, isOpen])

  const toastError = (message: string) => {
    toast({
      title: "錯誤",
      description: message,
      variant: "destructive",
    })
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
        unit_price: product ? Number(product.sale_price ?? product.price ?? 0) : 0,
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value }
    }
    setItems(newItems)
  }

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const generateOrderNumber = () => {
    const date = new Date()
    const prefix = "SO"
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")
    return `${prefix}${dateStr}${random}`
  }

  const syncAccountsReceivable = async (
    salesOrderId: string,
    customerCno: string | null,
    amount: number,
    dueDate: string,
    paid: boolean,
  ) => {
    const supabase = createClient()

    const { data: existingArRows, error: arQueryError } = await supabase
      .from("accounts_receivable")
      .select("id")
      .eq("sales_order_id", salesOrderId)
      .limit(1)

    if (arQueryError) {
      throw new Error(arQueryError.message || "無法查詢應收帳款")
    }

    const arPayload = {
      customer_cno: customerCno,
      amount_due: amount,
      total_amount: amount,
      paid_amount: paid ? amount : 0,
      due_date: dueDate,
      status: paid ? "paid" : "unpaid",
    }

    if (existingArRows && existingArRows.length > 0) {
      const { error: arUpdateError } = await supabase
        .from("accounts_receivable")
        .update(arPayload)
        .eq("id", existingArRows[0].id)

      if (arUpdateError) {
        throw new Error(arUpdateError.message || "無法更新應收帳款")
      }
      return
    }

    const { error: arInsertError } = await supabase.from("accounts_receivable").insert({
      sales_order_id: salesOrderId,
      ...arPayload,
    })

    if (arInsertError) {
      throw new Error(arInsertError.message || "無法建立應收帳款")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (items.length === 0) {
      toastError("請至少新增一項商品")
      return
    }

    const supabase = createClient()

    startTransition(async () => {
      try {
        const quantityByCode = new Map<string, number>()
        for (const item of items) {
          const code = String(item.code || "").trim()
          const quantity = Number(item.quantity)

          if (!code) {
            toastError("銷貨明細缺少商品編號(code)")
            return
          }
          if (!Number.isFinite(quantity) || quantity <= 0) {
            toastError(`商品 ${code} 的數量無效，請輸入大於 0 的數字`)
            return
          }

          quantityByCode.set(code, (quantityByCode.get(code) || 0) + quantity)
        }

        if (mode === "edit") {
          const saleId = String(sales?.id || "").trim()
          const orderNo = String(sales?.order_no || "").trim()

          if (!saleId) {
            toastError("找不到銷貨單 id，無法更新")
            return
          }
          if (!orderNo) {
            toastError("找不到銷貨單號，無法更新")
            return
          }

          const { error: updateError } = await supabase
            .from("sales_orders")
            .update({
              order_no: orderNo,
              customer_cno: formData.customer_cno || null,
              order_date: formData.order_date,
              total_amount: totalAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: formData.notes || null,
            })
            .eq("id", saleId)

          if (updateError) {
            toastError(updateError.message || "無法更新銷貨單")
            return
          }

          const { error: deleteError } = await supabase.from("sales_order_items").delete().eq("sales_order_id", saleId)
          if (deleteError) {
            toastError(deleteError.message || "無法更新銷貨明細")
            return
          }

          const orderItems = items.map((item) => ({
            sales_order_id: saleId,
            code: item.code || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price,
          }))

          const { error: itemsError } = await supabase.from("sales_order_items").insert(orderItems)
          if (itemsError) {
            toastError(itemsError.message || "無法新增銷貨明細")
            return
          }

          const oldQuantityByCode = new Map<string, number>()
          for (const oldItem of sales?.sales_order_items || []) {
            const code = String(oldItem.code || "").trim()
            const quantity = Number(oldItem.quantity || 0)
            if (!code || !Number.isFinite(quantity)) continue
            oldQuantityByCode.set(code, (oldQuantityByCode.get(code) || 0) + quantity)
          }

          const allCodes = new Set<string>([
            ...Array.from(oldQuantityByCode.keys()),
            ...Array.from(quantityByCode.keys()),
          ])

          for (const code of allCodes) {
            const oldQty = Number(oldQuantityByCode.get(code) || 0)
            const newQty = Number(quantityByCode.get(code) || 0)
            const delta = newQty - oldQty
            if (delta === 0) continue

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
              .update({ stock_qty: Math.max(0, coalescedStockQty - delta) })
              .eq("code", code)

            if (updateInventoryError) {
              throw new Error(updateInventoryError.message)
            }
          }

          await syncAccountsReceivable(
            saleId,
            formData.customer_cno || null,
            Number(totalAmount),
            formData.order_date,
            Boolean(formData.is_paid),
          )

          toast({
            title: "成功",
            description: "銷貨單更新成功",
          })

          setIsOpen(false)
          router.refresh()
          return
        }

        const finalOrderNumber = formData.order_no.trim() || generateOrderNumber()

        const { data: order, error: orderError } = await supabase
          .from("sales_orders")
          .insert({
            order_no: finalOrderNumber,
            customer_cno: formData.customer_cno || null,
            order_date: formData.order_date,
            total_amount: totalAmount,
            status: "completed",
            is_paid: formData.is_paid,
            notes: formData.notes || null,
          })
          .select()
          .single()

        if (orderError || !order) {
          const message = orderError?.message || "無法建立銷貨單，請稍後再試"
          console.error("[SalesDialog] 建立銷貨單失敗:", orderError)
          toastError(message)
          return
        }

        const orderItems = items.map((item) => ({
          sales_order_id: order.id,
          code: item.code || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.quantity * item.unit_price,
        }))

        const { error: itemsError } = await supabase.from("sales_order_items").insert(orderItems)

        if (itemsError) {
          const message = itemsError.message || "無法新增銷貨明細，請稍後再試"
          console.error("[SalesDialog] 新增銷貨明細失敗:", itemsError)
          toastError(message)
          return
        }

        const inventoryItems = Array.from(quantityByCode.entries()).map(([code, quantity]) => ({ code, quantity }))

        await Promise.all(
          inventoryItems.map(async (item) => {
            console.log("正在處理單據:", finalOrderNumber, "商品:", item.code)

            const { data: currentProduct, error: currentProductError } = await supabase
              .from("products")
              .select("code,name,price,stock_qty")
              .eq("code", item.code)
              .single()

            if (currentProductError || !currentProduct) {
              console.error("[SalesDialog] 讀取商品失敗:", currentProductError)
              throw new Error(currentProductError?.message || `找不到商品 ${item.code}`)
            }

            const coalescedStockQty = Number(currentProduct.stock_qty ?? 0)
            const { error: updateInventoryError } = await supabase
              .from("products")
              .update({ stock_qty: Math.max(0, coalescedStockQty - item.quantity) })
              .eq("code", item.code)

            if (updateInventoryError) {
              console.error("[SalesDialog] 更新庫存失敗:", updateInventoryError)
              throw new Error(updateInventoryError.message)
            }
          }),
        )

        await syncAccountsReceivable(
          String(order.id),
          order.customer_cno,
          Number(order.total_amount),
          order.order_date,
          Boolean(formData.is_paid),
        )

        toast({
          title: "成功",
          description: "銷貨單建立成功",
        })

        setIsOpen(false)
        setFormData({ order_no: "", customer_cno: "", order_date: new Date().toISOString().split("T")[0], notes: "", is_paid: false })
        setItems([])
        router.refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : "發生未知錯誤"
        console.error("[SalesDialog] 建立流程失敗:", error)
        toastError(message)
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[1400px] sm:max-w-[1400px] max-h-[95vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增銷貨單" : "編輯銷貨單"}</DialogTitle>
          <DialogDescription>{mode === "create" ? "填寫銷貨單資料與明細" : "修改已儲存的銷貨單資料與明細"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="order_no">單號</Label>
            <Input
              id="order_no"
              type="text"
              placeholder="輸入單號（可選）"
              value={formData.order_no}
              onChange={(e) => setFormData({ ...formData, order_no: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer">客戶</Label>
              <Select
                value={formData.customer_cno}
                onValueChange={(value) => setFormData({ ...formData, customer_cno: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="選擇客戶" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.code} value={customer.code}>
                      {customer.code} - {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="order_date">銷貨日期</Label>
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
              <Label>銷貨明細</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-4 w-4" />
                新增項目
              </Button>
            </div>

            <div className="rounded-lg border overflow-x-hidden">
              <Table className="w-full table-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead>商品</TableHead>
                    <TableHead className="w-20">數量</TableHead>
                    <TableHead className="w-24">單價</TableHead>
                    <TableHead className="w-24 text-right">小計</TableHead>
                    <TableHead className="w-10"></TableHead>
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
                        <TableCell className="min-w-0 pr-2">
                          <Select value={item.code} onValueChange={(v) => updateItem(index, "code", v)}>
                            <SelectTrigger className="w-full min-w-0">
                              <SelectValue placeholder="選擇商品" className="truncate" />
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
                        <TableCell className="px-2">
                          <Input
                            className="min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            type="number"
                            min="1"
                            value={item.quantity}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value) || 1)}
                          />
                        </TableCell>
                        <TableCell className="px-2">
                          <Input
                            className="min-w-0"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateItem(index, "unit_price", Number.parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap px-2">
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

            <div className="flex justify-end text-lg font-semibold">總計：${totalAmount.toLocaleString()}</div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || items.length === 0}>
              {isPending ? "儲存中..." : mode === "create" ? "建立銷貨單" : "儲存變更"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
