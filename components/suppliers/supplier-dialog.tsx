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
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { Supplier } from "@/lib/types"

interface SupplierDialogProps {
  mode: "create" | "edit"
  supplier?: Supplier
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SupplierDialog({ mode, supplier, children, open, onOpenChange }: SupplierDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const [formData, setFormData] = useState({
    name: supplier?.name || "",
    contact_person: supplier?.contact_person || "",
    phone: supplier?.phone || "",
    phone2: supplier?.phone2 || "",
    phone3: supplier?.phone3 || "",
    email: supplier?.email || "",
    address: supplier?.address || "",
    notes: supplier?.notes || "",
    statement_day: supplier?.statement_day?.toString() || ""
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const data = {
      name: formData.name,
      contact_person: formData.contact_person || null,
      phone: formData.phone || null,
      phone2: formData.phone2 || null,
      phone3: formData.phone3 || null,
      email: formData.email || null,
      address: formData.address || null,
      notes: formData.notes || null,
      statement_day: formData.statement_day ? Number(formData.statement_day) : null,
    }

    startTransition(async () => {
      try {
        let error
        if (mode === "create") {
          const result = await supabase.from("suppliers").insert(data)
          error = result.error
        } else if (supplier) {
          const result = await supabase.from("suppliers").update(data).eq("id", supplier.id)
          error = result.error
        }

        if (error) {
          toast({
            title: "錯誤",
            description: error.message || "操作失敗，請稍後再試",
            variant: "destructive",
          })
        } else {
          toast({
            title: "成功",
            description: mode === "create" ? "供應商新增成功" : "供應商更新成功",
          })
          setIsOpen(false)
          router.refresh()
        }
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
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新增供應商" : "編輯供應商"}</DialogTitle>
          <DialogDescription>{mode === "create" ? "填寫供應商資料" : "修改供應商資料"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">供應商名稱 *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contact_person">聯絡人</Label>
              <Input
                id="contact_person"
                value={formData.contact_person}
                onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">電話1</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone2">電話2</Label>
              <Input
                id="phone2"
                value={formData.phone2}
                onChange={(e) => setFormData({ ...formData, phone2: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone3">電話3</Label>
              <Input
                id="phone3"
                value={formData.phone3}
                onChange={(e) => setFormData({ ...formData, phone3: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">地址</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>


          <div className="space-y-2">
            <Label htmlFor="statement_day">月結日 (1-31)</Label>
            <Input
              id="statement_day"
              type="number"
              min={1}
              max={31}
              value={formData.statement_day}
              onChange={(e) => {
                const val = e.target.value
                setFormData({ ...formData, statement_day: val.replace(/[^\d]/g, "") })
              }}
              placeholder="請輸入月結日"
            />
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "儲存中..." : mode === "create" ? "新增" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
