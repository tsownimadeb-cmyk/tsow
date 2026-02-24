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
import type { Customer } from "@/lib/types"

interface CustomerDialogProps {
  mode: "create" | "edit"
  customer?: Customer
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CustomerDialog({ mode, customer, children, open, onOpenChange }: CustomerDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const [formData, setFormData] = useState({
    cno: customer?.cno || "",
    compy: customer?.compy || "",
    contact_person: customer?.contact_person || "",
    tel1: customer?.tel1 || "",
    tel11: customer?.tel11 || "",
    tel12: customer?.tel12 || "",
    addr: customer?.addr || "",
    notes: customer?.notes || "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const data = {
      cno: formData.cno,
      compy: formData.compy,
      contact_person: formData.contact_person || null,
      tel1: formData.tel1 || null,
      tel11: formData.tel11 || null,
      tel12: formData.tel12 || null,
      addr: formData.addr || null,
      notes: formData.notes || null,
    }

    startTransition(async () => {
      try {
        let error
        if (mode === "create") {
          const result = await supabase.from("customers").insert(data)
          error = result.error
        } else if (customer) {
          const result = await supabase.from("customers").update(data).eq("cno", customer.cno)
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
            description: mode === "create" ? "客戶新增成功" : "客戶更新成功",
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
          <DialogTitle>{mode === "create" ? "新增客戶" : "編輯客戶"}</DialogTitle>
          <DialogDescription>{mode === "create" ? "填寫客戶資料" : "修改客戶資料"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cno">客戶編號 *</Label>
              <Input
                id="cno"
                value={formData.cno}
                onChange={(e) => setFormData({ ...formData, cno: e.target.value })}
                disabled={mode === "edit"}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compy">公司名稱 *</Label>
              <Input
                id="compy"
                value={formData.compy}
                onChange={(e) => setFormData({ ...formData, compy: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_person">聯絡人</Label>
            <Input
              id="contact_person"
              value={formData.contact_person}
              onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tel1">電話1</Label>
              <Input
                id="tel1"
                value={formData.tel1}
                onChange={(e) => setFormData({ ...formData, tel1: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tel11">電話2</Label>
              <Input
                id="tel11"
                value={formData.tel11}
                onChange={(e) => setFormData({ ...formData, tel11: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tel12">電話3</Label>
              <Input
                id="tel12"
                value={formData.tel12}
                onChange={(e) => setFormData({ ...formData, tel12: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="addr">地址</Label>
            <Input
              id="addr"
              value={formData.addr}
              onChange={(e) => setFormData({ ...formData, addr: e.target.value })}
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
