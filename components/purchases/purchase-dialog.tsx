"use client"

import type React from "react"
import { useEffect, useMemo, useState, useTransition } from "react"
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
import { useIsMobile } from "@/hooks/use-mobile"
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
  const isMobile = useIsMobile()
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
  const productByCode = useMemo(() => {
    return new Map(products.map((product) => [product.code, product]))
  }, [products])
  const productSelectOptions = useMemo(() => {
    return products.map((product) => (
      <SelectItem key={product.code} value={product.code}>
        {product.code} - {product.name}
      </SelectItem>
    ))
  }, [products])

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

  const generateUuid = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0
      const value = char === "x" ? random : (random & 0x3) | 0x8
      return value.toString(16)
    })
  }

  const addItem = () => {
    setItems((prevItems) => [...prevItems, { code: "", quantity: 1, unit_price: 0 }])
  }

  const removeItem = (index: number) => {
    setItems((prevItems) => prevItems.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    setItems((prevItems) => {
      const newItems = [...prevItems]
      if (field === "code") {
        const product = productByCode.get(String(value))
        newItems[index] = {
          ...newItems[index],
          code: value as string,
          unit_price: product && typeof product.base_price === "number" && product.base_price > 0
            ? Number(product.base_price)
            : 0,
        }
      } else {
        newItems[index] = { ...newItems[index], [field]: value }
      }
      return newItems
    })
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // 收起行動裝置鍵盤
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      (document.activeElement as HTMLInputElement).blur()
    }
    if (items.length === 0) {
      toastApi.error("請至少新增一筆進貨明細")
      return
    }

    const supabase = createClient()

    startTransition(async () => {
      try {
        // 基礎驗證
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

        // 先嘗試使用離線 API（在線或離線都會試圖使用）
        const purchaseId = mode === 'edit' ? (purchase?.id || generateUuid()) : generateUuid()
        const poNumber = mode === "edit"
          ? String(purchase?.order_no || "").trim()
          : generateOrderNumber()

        if (!poNumber) {
          toastApi.error("找不到進貨單號，無法更新")
          return
        }

        // 準備項目數據
        const purchaseItems = items.map(item => ({
          id: generateUuid(),
          product_pno: item.code,
          quantity: item.quantity,
          unit_price: item.unit_price,
          amount: item.quantity * item.unit_price,
        }))

        const payloadForApi = {
          id: purchaseId,
          po_number: poNumber,
          supplier_id: formData.supplier_id || null,
          order_date: formData.order_date,
          delivery_date: formData.order_date, // 簡化：交期=訂購日
          total_amount: totalGoodsAmount,
          shipping_fee: shippingFee,
          status: 'completed',
          is_paid: Boolean(formData.is_paid),
          notes: formData.notes,
          items: purchaseItems,
        }

        // 調用離線 API
        const apiMethod = mode === 'edit' ? 'PUT' : 'POST'
        const response = await fetch('/api/offline/purchases', {
          method: apiMethod,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadForApi),
        })

        const responseData = await response.json()

        if (!response.ok) {
          toastApi.error(responseData.error || '操作失敗')
          return
        }

        // 如果在線模式成功，進行額外的庫存和應付帳款同步
        if (!responseData.offline && !responseData.atomic && supabase) {
          try {
            // 庫存計算邏輯
            const oldQuantityByCode = mode === 'edit' && purchase?.items
              ? new Map(purchase.items.map(item => [String(item.code || '').trim(), Number(item.quantity || 0)]))
              : new Map<string, number>()

            const allCodes = new Set<string>([
              ...Array.from(oldQuantityByCode.keys()),
              ...Array.from(quantityByCode.keys())
            ])

            for (const code of allCodes) {
              const oldQty = Number(oldQuantityByCode.get(code) || 0)
              const newQty = Number(quantityByCode.get(code) || 0)
              const delta = newQty - oldQty

              if (delta === 0) continue

              const { data: product } = await supabase
                .from("products")
                .select("code,stock_qty,purchase_qty_total,cost")
                .eq("code", code)
                .single()

              if (!product) continue

              const coalescedStockQty = Number(product.stock_qty ?? 0)
              const coalescedPurchaseQtyTotal = Number(product.purchase_qty_total ?? 0)

              const nextStockQty = Math.max(0, coalescedStockQty + delta)
              const nextPurchaseQtyTotal = Math.max(0, coalescedPurchaseQtyTotal + delta)

              const updatePayload: Record<string, number> = {
                stock_qty: nextStockQty,
                purchase_qty_total: nextPurchaseQtyTotal,
              }

              const itemTotalAmount = Number(amountByCode.get(code) ?? 0)
              const allocatedShippingForItem = totalGoodsAmount > 0 ? (itemTotalAmount / totalGoodsAmount) * shippingFee : 0
              const allocatedShippingPerUnit = newQty > 0 ? allocatedShippingForItem / newQty : 0
              const baseUnitCost = newQty > 0 ? itemTotalAmount / newQty : 0
              updatePayload.cost = baseUnitCost + allocatedShippingPerUnit

              await supabase
                .from("products")
                .update(updatePayload)
                .eq("code", code)
            }

            // 同步應付帳款
            await syncAccountsPayable(
              purchaseId,
              formData.supplier_id || null,
              totalGoodsAmount,
              formData.order_date,
              Boolean(formData.is_paid),
            )
          } catch (syncError) {
            console.error('[進貨] 庫存或應付帳款同步失敗:', syncError)
            // 不中斷使用者體驗，因為基本操作已成功
          }
        }

        toast({
          title: "成功",
          description: responseData.offline
            ? "已儲存至本地，網路恢復後會同步"
            : mode === "edit" ? "進貨單已更新" : "進貨單已建立",
        })

        setIsOpen(false)
        router.refresh()
      } catch (error: any) {
        toastApi.error(error.message || '操作失敗，請稍後再試')
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
              inputMode="decimal"
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

            {isMobile ? (
              <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4 border rounded bg-white">尚無項目，請點擊「新增項目」</div>
                ) : (
                  items.map((item, index) => (
                    <div key={index} className="border rounded bg-white p-2 pt-8 flex flex-col gap-1 relative">
                      <span className="absolute top-2 left-2 inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-xs font-semibold text-foreground">
                        {index + 1}
                      </span>
                      <button type="button" className="absolute top-2 right-2 text-muted-foreground" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted-foreground">商品</span>
                        <div className="flex-1">
                          <Select value={item.code} onValueChange={(v) => updateItem(index, "code", v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="選擇商品" />
                            </SelectTrigger>
                            <SelectContent>{productSelectOptions}</SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted-foreground">數量</span>
                        <Input
                          className="flex-1"
                          type="number"
                          inputMode="numeric"
                          min="1"
                          value={item.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted-foreground">單價</span>
                        <Input
                          className="flex-1"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateItem(index, "unit_price", Number.parseFloat(e.target.value) || 0)}
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
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table className="min-w-[600px] text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center">#</TableHead>
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
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-4">
                          尚無項目，請點擊「新增項目」
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-center font-semibold text-muted-foreground">{index + 1}</TableCell>
                          <TableCell>
                            <Select value={item.code} onValueChange={(v) => updateItem(index, "code", v)}>
                              <SelectTrigger>
                                <SelectValue placeholder="選擇商品" />
                              </SelectTrigger>
                              <SelectContent>{productSelectOptions}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={item.quantity}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => updateItem(index, "quantity", Number.parseInt(e.target.value) || 1)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              inputMode="decimal"
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
            )}

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
