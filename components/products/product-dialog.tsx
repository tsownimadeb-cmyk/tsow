"use client"

import type React from "react"
import { useEffect, useState } from "react"
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
import { createClient } from "@/lib/supabase/client" // 請確認此路徑與客戶表一致
import { useToast } from "@/hooks/use-toast"
import type { Product as ProductType, Supplier } from "@/lib/types"

type EditableProduct = Pick<ProductType, "code" | "name" | "spec" | "unit" | "category" | "base_price" | "purchase_price" | "price" | "cost" | "sale_price" | "supplier_id" | "supplier"> & {
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
  base_price: number
  price: number
  sale_price: number
  stock_qty: number
  purchase_qty_total: number
  safety_stock: number
  supplier_id: string
}

function toFormData(product?: EditableProduct): ProductFormData {
  return {
    code: product?.code || "",
    name: product?.name || "",
    spec: product?.spec || "",
    unit: product?.unit || "",
    category: product?.category || "",
    base_price: Number(product?.base_price ?? product?.purchase_price ?? product?.cost ?? 0),
    price: Number(product?.price || 0),
    sale_price: Number(product?.sale_price || 0),
    stock_qty: Number(product?.stock_qty || 0),
    purchase_qty_total: Number(product?.purchase_qty_total || 0),
    safety_stock: Number(product?.safety_stock || 0),
    supplier_id: typeof product?.supplier_id === 'string' ? product.supplier_id : (product?.supplier?.id || ""),
  }
}

interface ProductDialogProps {
  mode: "create" | "edit"
  product?: EditableProduct
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function isBasePriceColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("base_price") && (message.includes("column") || message.includes("schema cache"))
}

export function ProductDialog({ mode, product, children, open, onOpenChange }: ProductDialogProps) {
  const router = useRouter()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const { toast } = useToast()
  const [isPending, setIsPending] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const isOpen = open !== undefined ? open : internalOpen
  const setIsOpen = onOpenChange || setInternalOpen

  const [formData, setFormData] = useState<ProductFormData>(toFormData(product))

  useEffect(() => {
    setMounted(true)

    const fetchSuppliers = async () => {
      const supabase = createClient()
      const { data, error } = await supabase.from("suppliers").select("id, name").order("name")
      if (!error && data) {
        setSuppliers(data as Supplier[])
      }
    }

    fetchSuppliers()
  }, [])

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
      sale_price: Number(formData.sale_price),
    }

    const payloadWithBasePrice = {
      ...basePayload,
      base_price: Number(formData.base_price),
      supplier_id: formData.supplier_id || null,
    }

    const payloadNewSchema: Record<string, any> = {
      ...payloadWithBasePrice,
      stock_qty: Number(formData.stock_qty),
      purchase_qty_total: Number(formData.purchase_qty_total),
      safety_stock: Number(formData.safety_stock),
    }

    if (mode === "create" && Number(formData.purchase_qty_total) <= 0) {
      payloadNewSchema.cost = 0
    }

    try {
      setIsPending(true)

      if (mode === "create") {
        const createNew = await supabase.from("products").insert(payloadNewSchema)
        if (createNew.error) {
          if (isBasePriceColumnMissing(createNew.error)) {
            const fallbackPayload = {
              ...basePayload,
              stock_qty: Number(formData.stock_qty),
              purchase_qty_total: Number(formData.purchase_qty_total),
              safety_stock: Number(formData.safety_stock),
            }
            const createFallback = await supabase.from("products").insert(fallbackPayload)
            if (createFallback.error) throw createFallback.error
          } else {
            throw createNew.error
          }
        }
      } else {
        if (!product?.code) {
          throw new Error("缺少 product.code，無法更新")
        }

        const updateNew = await supabase
          .from("products")
          .update(payloadNewSchema)
          .eq("code", formData.code.trim())
        if (updateNew.error) {
          if (isBasePriceColumnMissing(updateNew.error)) {
            const fallbackPayload = {
              ...basePayload,
              stock_qty: Number(formData.stock_qty),
              purchase_qty_total: Number(formData.purchase_qty_total),
              safety_stock: Number(formData.safety_stock),
            }
            const updateFallback = await supabase
              .from("products")
              .update(fallbackPayload)
              .eq("code", formData.code.trim())
            if (updateFallback.error) throw updateFallback.error
          } else {
            throw updateNew.error
          }
        }
      }

      toast({ title: "成功", description: mode === "create" ? "新增成功" : "更新成功" })
      setIsOpen(false)
      router.refresh()
    } catch (error: any) {
      toast({ title: "錯誤", description: error.message, variant: "destructive" })
    } finally {
      setIsPending(false)
    }
  }

  if (!mounted) {
    return children ? <>{children}</> : null
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
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>預設進貨單價</Label>
              <Input type="number" value={formData.base_price} onChange={(e) => setFormData({...formData, base_price: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>定價</Label>
              <Input type="number" value={formData.price} onChange={(e) => setFormData({...formData, price: Number(e.target.value)})} />
            </div>
            <div className="space-y-2">
              <Label>特價</Label>
              <Input type="number" value={formData.sale_price} onChange={(e) => setFormData({...formData, sale_price: Number(e.target.value)})} />
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
          <div className="space-y-2">
            <Label>廠商</Label>
            <select
              className="w-full border rounded px-2 py-1"
              value={formData.supplier_id}
              onChange={e => setFormData({ ...formData, supplier_id: e.target.value })}
            >
              <option value="">— 請選擇廠商 —</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>{isPending ? "儲存中..." : "儲存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}