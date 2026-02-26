"use client"

import type React from "react"
import { useState, useTransition } from "react"
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
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { Customer } from "@/lib/types"

type EditableCustomer = Customer & {
  addr?: string | null
  tel2?: string | null
  tel3?: string | null
  fax?: string | null
}

interface CustomerDialogProps {
  mode: "create" | "edit"
  customer?: EditableCustomer
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CustomerDialog({ mode, customer, children, open, onOpenChange }: CustomerDialogProps) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [internalOpen, setInternalOpen] = useState(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const [formData, setFormData] = useState({
    code: customer?.code || "",
    name: customer?.name || "",
    tel1: customer?.tel1 || "",
    tel2: customer?.tel2 || customer?.tel11 || "",
    tel3: customer?.fax || customer?.tel3 || customer?.tel12 || "",
    address: customer?.addr || "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const payload = {
      name: formData.name,
      addr: formData.address || null,
      tel1: formData.tel1 || null,
      tel2: formData.tel2 || null,
      fax: formData.tel3 || null,
    }

    startTransition(async () => {
      try {
        let error
        if (mode === "create") {
          const result = await supabase.from("customers").insert({ code: formData.code, ...payload })
          error = result.error
        } else if (customer) {
          const result = await supabase.from("customers").update(payload).eq("code", formData.code)
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
          window.location.reload()
          setIsOpen(false)
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
              <Label htmlFor="code">客戶編號 *</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={mode === "edit"}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">公司名稱 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tel1">電話1</Label>
            <Input
              id="tel1"
              value={formData.tel1}
              onChange={(e) => setFormData({ ...formData, tel1: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tel2">電話2</Label>
            <Input
              id="tel2"
              value={formData.tel2}
              onChange={(e) => setFormData({ ...formData, tel2: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tel3">電話3</Label>
            <Input
              id="tel3"
              value={formData.tel3}
              onChange={(e) => setFormData({ ...formData, tel3: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addr">地址</Label>
            <Input
              id="addr"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
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
