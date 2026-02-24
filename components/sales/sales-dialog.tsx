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
import type { Customer, Product } from "@/lib/types"

interface SalesDialogProps {
  customers: Customer[]
  products: Product[]
  mode: "create"
  children?: React.ReactNode
}

interface OrderItem {
  product_pno: string
  quantity: number
  unit_price: number
}

export function SalesDialog({ customers, products, mode, children }: SalesDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  const [formData, setFormData] = useState({
    order_number: "",
    customer_cno: "",
    order_date: new Date().toISOString().split("T")[0],
    notes: "",
    is_paid: false,
  })

  const [items, setItems] = useState<OrderItem[]>([])

  const addItem = () => {
    setItems([...items, { product_pno: "", quantity: 1, unit_price: 0 }])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OrderItem, value: string | number) => {
    const newItems = [...items]
    if (field === "product_pno") {
      const product = products.find((p) => p.pno === value)
      newItems[index] = {
        ...newItems[index],
        product_pno: value as string,
        unit_price: product ? Number(product.price) : 0,
      }
    } else {
      newItems[index] = { ...newItems[index], [field]: value }
    }
    setItems(newItems)
  }

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (items.length === 0) {
      toast({
        title: "錯誤",
        description: "請至少新增一項商品",
        variant: "destructive",
      })
      return
    }

    const supabase = createClient()

    const generateOrderNumber = () => {
      const date = new Date()
      const prefix = "SO"
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")
      const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0")
      return `${prefix}${dateStr}${random}`
    }

    const finalOrderNumber = formData.order_number.trim() || generateOrderNumber()

    startTransition(async () => {
      try {
        const { data: order, error: orderError } = await supabase
          .from("sales_orders")
          .insert({
            order_number: finalOrderNumber,
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
          toast({
            title: "錯誤",
            description: orderError?.message || "無法建立銷貨單，請稍後再試",
            variant: "destructive",
          })
          return
        }

        const orderItems = items.map((item) => ({
          sales_order_id: order.id,
          product_pno: item.product_pno || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.quantity * item.unit_price,
        }))

        const { error: itemsError } = await supabase.from("sales_order_items").insert(orderItems)

        if (itemsError) {
          toast({
            title: "錯誤",
            description: itemsError.message || "無法新增銷貨明細，請稍後再試",
            variant: "destructive",
          })
          return
        }

        const { error: arError } = await supabase.from("accounts_receivable").insert({
          sales_order_id: order.id,
          customer_cno: order.customer_cno,
          amount_due: Number(order.total_amount),
          total_amount: Number(order.total_amount),
          paid_amount: formData.is_paid ? Number(order.total_amount) : 0,
          due_date: order.order_date,
          status: formData.is_paid ? "paid" : "unpaid",
        })

        if (arError) {
          toast({
            title: "警告",
            description: `銷貨單已建立，但同步應收帳款失敗：${arError.message}`,
            variant: "destructive",
          })
        }

        toast({
          title: "成功",
          description: "銷貨單建立成功",
        })

        setOpen(false)
        setFormData({ order_number: "", customer_cno: "", order_date: new Date().toISOString().split("T")[0], notes: "", is_paid: false })
        setItems([])
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "發生未知錯誤",
          variant: "destructive",
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[95vw] max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增銷貨單</DialogTitle>
          <DialogDescription>填寫銷貨單資料與明細</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="order_number">單號</Label>
            <Input
              id="order_number"
              type="text"
              placeholder="輸入單號（可選）"
              value={formData.order_number}
              onChange={(e) => setFormData({ ...formData, order_number: e.target.value })}
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
                    <SelectItem key={customer.cno} value={customer.cno}>
                      {customer.cno} - {customer.compy}
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
                          <Select value={item.product_pno} onValueChange={(v) => updateItem(index, "product_pno", v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="選擇商品" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((product) => (
                                <SelectItem key={product.pno} value={product.pno}>
                                  {product.pno} - {product.pname}
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

            <div className="flex justify-end text-lg font-semibold">總計：${totalAmount.toLocaleString()}</div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isPending || items.length === 0}>
              {isPending ? "儲存中..." : "建立銷貨單"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
