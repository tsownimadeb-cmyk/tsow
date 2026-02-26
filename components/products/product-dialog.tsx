"use client"

import type React from "react"
import { useEffect, useState } from "react"
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
import { createClient } from "@/lib/supabase/client" // 請確認此路徑與客戶表一致
import { useToast } from "@/hooks/use-toast"
import type { Product as ProductType } from "@/lib/types"

type EditableProduct = Pick<ProductType, "code" | "name" | "spec" | "unit" | "category" | "price" | "cost" | "sale_price"> & {
  stock_qty?: number | null
  purchase_qty_total?: number | null
  safety_stock?: number | null
}

interface ProductFormData {
  code: string
  name: string
  spec: string
  unit: string
  category: string
  price: number
  cost: number
  sale_price: number
  stock_qty: number
  purchase_qty_total: number
  safety_stock: number
}

function toFormData(product?: EditableProduct): ProductFormData {
  return {
    code: product?.code || "",
    name: product?.name || "",
    spec: product?.spec || "",
    unit: product?.unit || "",
    category: product?.category || "",
    price: Number(product?.price || 0),
    cost: Number(product?.cost || 0),
    sale_price: Number(product?.sale_price || 0),
    stock_qty: Number(product?.stock_qty || 0),
    purchase_qty_total: Number(product?.purchase_qty_total || 0),
    safety_stock: Number(product?.safety_stock || 0),
  }
}

interface ProductDialogProps {
  mode: "create" | "edit"
  product?: EditableProduct
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ProductDialog({ mode, product, children, open, onOpenChange }: ProductDialogProps) {
  const { toast } = useToast()
  const [isPending, setIsPending] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)

  const isOpen = open !== undefined ? open : internalOpen
  const setIsOpen = onOpenChange || setInternalOpen

  const [formData, setFormData] = useState<ProductFormData>(toFormData(product))

  useEffect(() => {
    setFormData(toFormData(product))
  }, [product])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const basePayload = {
      code: formData.code,
      name: formData.name,
      spec: formData.spec || null,
      unit: formData.unit || null,
      category: formData.category || null,
      price: Number(formData.price),
      cost: Number(formData.cost),
      sale_price: Number(formData.sale_price),
    }

    const payloadNewSchema = {
      ...basePayload,
      stock_qty: Number(formData.stock_qty),
      purchase_qty_total: Number(formData.purchase_qty_total),
      safety_stock: Number(formData.safety_stock),
    }

    try {
      setIsPending(true)

      if (mode === "create") {
        const createNew = await supabase.from("products").insert(payloadNewSchema)
        if (createNew.error) throw createNew.error
      } else {
        if (!product?.code) {
          throw new Error("缺少 product.code，無法更新")
        }

        const updateNew = await supabase
          .from("products")
          .update(payloadNewSchema)
          .eq("code", formData.code.trim())
        if (updateNew.error) throw updateNew.error
      }

      toast({ title: "成功", description: mode === "create" ? "新增成功" : "更新成功" })
      window.location.reload()
      setIsOpen(false)
    } catch (error: any) {
      toast({ title: "錯誤", description: error.message, variant: "destructive" })
    } finally {
      setIsPending(false)
    }
  }

  return (  
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增商品" : "編輯商品"}</DialogTitle>
          <DialogDescription>請填寫商品詳細資訊</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>商品編號 *</Label>
              <Input value={formData.code} onChange={(e) => setFormData({...formData, code: e.target.value})} disabled={mode === "edit"} required />
            </div>
            <div className="space-y-2">
              <Label>種類</Label>
              <Input value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>商品名稱 *</Label>
            <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>規格</Label>
              <Input value={formData.spec} onChange={(e) => setFormData({...formData, spec: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>單位</Label>
              <Input value={formData.unit} onChange={(e) => setFormData({...formData, unit: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>定價</Label>
              <Input type="number" value={formData.price} onChange={(e) => setFormData({...formData, price: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>特價</Label>
              <Input type="number" value={formData.sale_price} onChange={(e) => setFormData({...formData, sale_price: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>進貨成本</Label>
              <Input type="number" value={formData.cost} onChange={(e) => setFormData({...formData, cost: Number(e.target.value)})} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>初始庫存</Label>
              <Input type="number" value={formData.stock_qty} onChange={(e) => setFormData({...formData, stock_qty: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>進貨總量</Label>
              <Input type="number" value={formData.purchase_qty_total} onChange={(e) => setFormData({...formData, purchase_qty_total: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>安全庫存</Label>
              <Input type="number" value={formData.safety_stock} onChange={(e) => setFormData({...formData, safety_stock: Number(e.target.value)})} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>{isPending ? "儲存中..." : "儲存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}