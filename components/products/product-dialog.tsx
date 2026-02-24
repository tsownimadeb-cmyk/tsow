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
import { createClient } from "@/lib/supabase/client" // 請確認此路徑與客戶表一致
import { useToast } from "@/hooks/use-toast"

interface Product {
  pno: string
  pname: string
  spec?: string
  unit?: string
  category?: string
  price?: number
  cost?: number
  sale_price?: number
}

interface ProductDialogProps {
  mode: "create" | "edit"
  product?: Product
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ProductDialog({ mode, product, children, open, onOpenChange }: ProductDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isOpen = open !== undefined ? open : internalOpen
  const setIsOpen = onOpenChange || setInternalOpen

  const [formData, setFormData] = useState({
    pno: product?.pno || "",
    pname: product?.pname || "",
    spec: product?.spec || "",
    unit: product?.unit || "",
    category: product?.category || "",
    price: product?.price || 0,
    cost: product?.cost || 0,
    sale_price: product?.sale_price || 0,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const data = {
      pno: formData.pno,
      pname: formData.pname,
      spec: formData.spec || null,
      unit: formData.unit || null,
      category: formData.category || null,
      price: Number(formData.price),
      cost: Number(formData.cost),
      sale_price: Number(formData.sale_price),
    }

    startTransition(async () => {
      try {
        let error
        if (mode === "create") {
          const result = await supabase.from("products").insert(data)
          error = result.error
        } else {
          const result = await supabase.from("products").update(data).eq("pno", product?.pno)
          error = result.error
        }

        if (error) throw error

        toast({ title: "成功", description: mode === "create" ? "商品新增成功" : "商品更新成功" })
        setIsOpen(false)
        router.refresh()
      } catch (error: any) {
        toast({ title: "錯誤", description: error.message, variant: "destructive" })
      }
    })
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
              <Input value={formData.pno} onChange={(e) => setFormData({...formData, pno: e.target.value})} disabled={mode === "edit"} required />
            </div>
            <div className="space-y-2">
              <Label>種類</Label>
              <Input value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>商品名稱 *</Label>
            <Input value={formData.pname} onChange={(e) => setFormData({...formData, pname: e.target.value})} required />
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
          <DialogFooter>
            <Button type="submit" disabled={isPending}>{isPending ? "儲 log 中..." : "儲存"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}