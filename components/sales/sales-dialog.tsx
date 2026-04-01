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
import { formatCurrencyOneDecimal } from "@/lib/utils"
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

type DeliveryMethod = "self_delivery" | "company_delivery" | "customer_pickup"
const WALK_IN_CUSTOMER_VALUE = "__WALK_IN_CUSTOMER__"
const STOCK_ADJUSTMENT_CUSTOMER_VALUE = "__STOCK_ADJUSTMENT_CUSTOMER__"
const STOCK_ADJUSTMENT_NOTE_TAG = "[STOCK_ADJUSTMENT]"

export function SalesDialog({ customers, products, mode, sales, children, open, onOpenChange }: SalesDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const hasStockAdjustmentTag = (notes: string | null | undefined) =>
    String(notes || "")
      .split("\n")
      .map((line) => line.trim())
      .some((line) => line === STOCK_ADJUSTMENT_NOTE_TAG)

  const stripStockAdjustmentTag = (notes: string | null | undefined) =>
    String(notes || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== STOCK_ADJUSTMENT_NOTE_TAG)
      .join("\n")

  const getInitialFormData = () => ({
    order_no: sales?.order_no || "",
    customer_cno: sales?.customer_cno
      || (mode === "edit" && hasStockAdjustmentTag(sales?.notes) ? STOCK_ADJUSTMENT_CUSTOMER_VALUE : mode === "edit" ? WALK_IN_CUSTOMER_VALUE : ""),
    delivery_method: (sales?.delivery_method as DeliveryMethod | null) || "self_delivery",
    order_date: sales?.order_date || new Date().toISOString().split("T")[0],
    notes: stripStockAdjustmentTag(sales?.notes),
    is_paid: Boolean(sales?.is_paid),
  })

  const resolveCustomerCno = (value: string) => {
    const normalizedValue = String(value || "").trim()
    if (!normalizedValue || normalizedValue === WALK_IN_CUSTOMER_VALUE || normalizedValue === STOCK_ADJUSTMENT_CUSTOMER_VALUE) {
      return null
    }
    return normalizedValue
  }

  const resolveNotesForSave = (rawNotes: string, selectedCustomerValue: string) => {
    const cleanNotes = stripStockAdjustmentTag(rawNotes)
    if (selectedCustomerValue === STOCK_ADJUSTMENT_CUSTOMER_VALUE) {
      return cleanNotes ? `${STOCK_ADJUSTMENT_NOTE_TAG}\n${cleanNotes}` : STOCK_ADJUSTMENT_NOTE_TAG
    }
    return cleanNotes || null
  }

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
  const customerSelectValue =
    formData.customer_cno === WALK_IN_CUSTOMER_VALUE || formData.customer_cno === STOCK_ADJUSTMENT_CUSTOMER_VALUE
      ? ""
      : formData.customer_cno

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

  const formatDbError = (error: unknown, fallback: string) => {
    if (!error) return fallback
    if (error instanceof Error) return error.message || fallback

    if (typeof error === "object") {
      const maybe = error as {
        message?: string
        details?: string
        hint?: string
        code?: string
      }

      const pieces = [maybe.message, maybe.details, maybe.hint].filter(Boolean)
      if (pieces.length > 0) {
        return pieces.join(" | ")
      }

      if (maybe.code) {
        return `${fallback} (code: ${maybe.code})`
      }
    }

    return fallback
  }

  const isUniqueViolationError = (error: unknown) => {
    if (!error || typeof error !== "object") return false
    const maybe = error as { code?: string; message?: string; details?: string }
    const text = `${maybe.message || ""} ${maybe.details || ""}`.toLowerCase()
    return maybe.code === "23505" || text.includes("duplicate key") || text.includes("unique constraint")
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
      let unitPrice = 0;
      if (product) {
        // 根據客戶價格等級決定價格欄位
        const customer = customers.find((c) => c.code === formData.customer_cno);
        const priceLevel = customer?.price_level || "sale";
        unitPrice = priceLevel === "price"
          ? Number(product.price ?? 0)
          : Number(product.sale_price ?? product.price ?? 0);
      }
      newItems[index] = {
        ...newItems[index],
        code: value as string,
        unit_price: unitPrice,
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
    const settledAt = new Date().toISOString()

    const arPayload = {
      sales_order_id: salesOrderId,
      customer_cno: customerCno,
      amount_due: amount,
      total_amount: amount,
      paid_amount: paid ? amount : 0,
      overpaid_amount: 0,
      paid_at: paid ? settledAt : null,
      due_date: dueDate,
      status: paid ? "paid" : "unpaid",
    }

    const { data: updatedRows, error: arUpdateError } = await supabase
      .from("accounts_receivable")
      .update(arPayload)
      .eq("sales_order_id", salesOrderId)
      .select("id")
      .limit(1)

    if (arUpdateError) {
      throw new Error(arUpdateError.message || "無法同步應收帳款")
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { error: arInsertError } = await supabase
        .from("accounts_receivable")
        .insert(arPayload)

      if (arInsertError) {
        if (!isUniqueViolationError(arInsertError)) {
          throw new Error(arInsertError.message || "無法同步應收帳款")
        }

        const { error: retryUpdateError } = await supabase
          .from("accounts_receivable")
          .update(arPayload)
          .eq("sales_order_id", salesOrderId)

        if (retryUpdateError) {
          throw new Error(retryUpdateError.message || "無法同步應收帳款")
        }
      }
    }

    if (paid || !customerCno || amount <= 0) {
      return
    }

    const { data: targetRow, error: targetRowError } = await supabase
      .from("accounts_receivable")
      .select("id,paid_amount,amount_due")
      .eq("sales_order_id", salesOrderId)
      .maybeSingle()

    if (targetRowError || !targetRow) {
      throw new Error(targetRowError?.message || "無法取得新單應收資料")
    }

    const currentPaid = Math.max(0, Math.min(Number(targetRow.paid_amount ?? 0) || 0, amount))
    let remainingNeed = Math.max(0, amount - currentPaid)

    if (remainingNeed <= 0) {
      return
    }

    const { data: overpaidRows, error: overpaidQueryError } = await supabase
      .from("accounts_receivable")
      .select("id,overpaid_amount")
      .eq("customer_cno", customerCno)
      .gt("overpaid_amount", 0)
      .neq("sales_order_id", salesOrderId)
      .order("created_at", { ascending: true })

    if (overpaidQueryError) {
      throw new Error(overpaidQueryError.message || "無法查詢客戶溢收資料")
    }

    let consumedOverpaid = 0
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
        throw new Error(consumeError.message || "無法套用溢收抵扣")
      }

      consumedOverpaid += consume
      remainingNeed -= consume
    }

    if (consumedOverpaid <= 0) {
      return
    }

    const nextPaidAmount = Math.min(amount, currentPaid + consumedOverpaid)
    const isFullyPaid = nextPaidAmount >= amount
    const nextStatus: "unpaid" | "partially_paid" | "paid" =
      nextPaidAmount <= 0
        ? "unpaid"
        : isFullyPaid
          ? "paid"
          : "partially_paid"

    const { error: updateTargetError } = await supabase
      .from("accounts_receivable")
      .update({
        paid_amount: nextPaidAmount,
        paid_at: settledAt,
        status: nextStatus,
      })
      .eq("id", targetRow.id)

    if (updateTargetError) {
      throw new Error(updateTargetError.message || "無法更新新單抵扣結果")
    }

    const { error: updateSalesPaidError } = await supabase
      .from("sales_orders")
      .update({ is_paid: isFullyPaid })
      .eq("id", salesOrderId)

    if (updateSalesPaidError) {
      throw new Error(updateSalesPaidError.message || "無法更新新單付款狀態")
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
          const orderNo = String(formData.order_no || "").trim()
          const customerCno = resolveCustomerCno(formData.customer_cno)
          const notesForSave = resolveNotesForSave(formData.notes, formData.customer_cno)

          if (!saleId) {
            toastError("找不到銷貨單 id，無法更新")
            return
          }
          if (!orderNo) {
            toastError("請輸入銷貨單號")
            return
          }

          const { error: updateError } = await supabase
            .from("sales_orders")
            .update({
              order_no: orderNo,
              customer_cno: customerCno,
              delivery_method: formData.delivery_method,
              order_date: formData.order_date,
              total_amount: totalAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: notesForSave,
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
              .update({ stock_qty: coalescedStockQty - delta })
              .eq("code", code)

            if (updateInventoryError) {
              throw new Error(updateInventoryError.message)
            }
          }

          await syncAccountsReceivable(
            saleId,
            customerCno,
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

        let finalOrderNumber = formData.order_no.trim() || generateOrderNumber()
        let order: any = null
        let orderError: unknown = null
        const customerCno = resolveCustomerCno(formData.customer_cno)
        const notesForSave = resolveNotesForSave(formData.notes, formData.customer_cno)

        for (let retry = 0; retry < 3; retry += 1) {
          const result = await supabase
            .from("sales_orders")
            .insert({
              order_no: finalOrderNumber,
              customer_cno: customerCno,
              delivery_method: formData.delivery_method,
              order_date: formData.order_date,
              total_amount: totalAmount,
              status: "completed",
              is_paid: formData.is_paid,
              notes: notesForSave,
            })
            .select()
            .single()

          order = result.data
          orderError = result.error

          if (!orderError && order) {
            break
          }

          const shouldRetryWithNewOrderNo =
            !formData.order_no.trim() &&
            isUniqueViolationError(orderError)

          if (!shouldRetryWithNewOrderNo) {
            break
          }

          finalOrderNumber = generateOrderNumber()
        }

        if (orderError || !order) {
          const message = formatDbError(orderError, "無法建立銷貨單，請稍後再試")
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
              .update({ stock_qty: coalescedStockQty - item.quantity })
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
        setFormData({
          order_no: "",
          customer_cno: "",
          delivery_method: "self_delivery",
          order_date: new Date().toISOString().split("T")[0],
          notes: "",
          is_paid: false,
        })
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
          {/* 單號欄位 */}
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

          {/* 客戶、日期、配送方式：桌面版為橫排，手機版為直排 */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* 客戶選擇器 */}
            <div className="flex-1">
              <Label htmlFor="customer" className="mb-1 block text-sm font-medium">客戶</Label>
              <Select
                value={customerSelectValue}
                onValueChange={(value) => setFormData({ ...formData, customer_cno: value })}
              >
                <SelectTrigger id="customer" className="h-10">
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
            {/* 散客按鈕 */}
            <div className="flex flex-col items-end justify-end">
              <Label className="mb-1 block text-sm font-medium invisible">散客</Label>
              <Button
                type="button"
                className="h-10"
                variant={formData.customer_cno === WALK_IN_CUSTOMER_VALUE ? "default" : "outline"}
                onClick={() => setFormData({ ...formData, customer_cno: WALK_IN_CUSTOMER_VALUE })}
              >
                散客
              </Button>
            </div>
            {/* 銷貨日期 */}
            <div className="flex flex-col min-w-[180px]">
              <Label htmlFor="order_date" className="mb-1 block text-sm font-medium">銷貨日期</Label>
              <Input
                id="order_date"
                type="date"
                className="h-10"
                value={formData.order_date}
                onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
              />
            </div>
            {/* 配送方式 */}
            <div className="flex flex-col min-w-[180px]">
              <Label htmlFor="delivery_method" className="mb-1 block text-sm font-medium">配送方式</Label>
              <Select
                value={formData.delivery_method}
                onValueChange={(value: DeliveryMethod) => setFormData({ ...formData, delivery_method: value })}
              >
                <SelectTrigger id="delivery_method" className="h-10">
                  <SelectValue placeholder="選擇配送方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self_delivery">本車配送</SelectItem>
                  <SelectItem value="company_delivery">公司配送</SelectItem>
                  <SelectItem value="customer_pickup">客戶自取</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>



          {/* 銷貨明細：桌面 table + 手機卡片 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>銷貨明細</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-4 w-4" />
                新增項目
              </Button>
            </div>

            {/* 桌面 table */}
            <div className="rounded-lg border overflow-x-auto hidden sm:block">
              <Table className="min-w-[600px] text-sm">
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
                        <TableCell>
                          <Select value={item.code} onValueChange={(v) => updateItem(index, "code", v)}>
                            <SelectTrigger className="w-full">
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

            {/* 手機卡片式明細 */}
            <div className="sm:hidden flex flex-col gap-2">
              {items.length === 0 ? (
                <div className="text-center text-muted-foreground py-4 border rounded bg-white">尚無項目，請點擊「新增項目」</div>
              ) : (
                items.map((item, index) => (
                  <div key={index} className="border rounded bg-white p-2 flex flex-col gap-1 relative">
                    <button type="button" className="absolute top-2 right-2 text-muted-foreground" onClick={() => removeItem(index)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-muted-foreground">商品</span>
                      <div className="flex-1">
                        <Select value={item.code} onValueChange={(v) => updateItem(index, 'code', v)}>
                          <SelectTrigger className="w-full">
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
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-muted-foreground">數量</span>
                      <Input
                        className="flex-1"
                        type="number"
                        min="1"
                        value={item.quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateItem(index, 'quantity', Number.parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-muted-foreground">單價</span>
                      <Input
                        className="flex-1"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateItem(index, 'unit_price', Number.parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 text-xs text-muted-foreground">小計</span>
                      <span className="flex-1 text-right font-semibold">{formatCurrencyOneDecimal(item.quantity * item.unit_price)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1 text-right">
              <div className="text-sm text-muted-foreground">總計：{formatCurrencyOneDecimal(totalAmount)}</div>
            </div>
          </div>

          {/* 備註欄位 */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="notes">備註</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="min-h-[56px]"
            />
          </div>

          <div className="mt-2 flex flex-col items-end gap-2">
            <div className="flex w-full items-end justify-end gap-4">
              <div className="flex h-10 items-center gap-2 self-end">
                <Checkbox
                  id="is_paid"
                  checked={formData.is_paid}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_paid: Boolean(checked) })}
                />
                <Label htmlFor="is_paid" className="text-sm font-medium cursor-pointer">已付款</Label>
              </div>
            </div>
            <DialogFooter className="justify-end w-full">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={isPending || items.length === 0}>
                {isPending ? "儲存中..." : mode === "create" ? "建立銷貨單" : "儲存變更"}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
