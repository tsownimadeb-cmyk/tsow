"use client"

import type React from "react"
import { useEffect, useState, useTransition } from "react"
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
import { useToast } from "@/hooks/use-toast"
import type { Customer } from "@/lib/types"

type EditableCustomer = Customer & {
  addr?: string | null
  address?: string | null
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
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setIsOpen = isControlled ? onOpenChange! : setInternalOpen

  const [formData, setFormData] = useState({
    code: customer?.code || "",
    name: customer?.name || "",
    tel1: customer?.tel1 || "",
    tel2: customer?.tel2 || customer?.tel11 || "",
    tel3: customer?.fax || customer?.tel3 || customer?.tel12 || "",
    address: customer?.addr || customer?.address || "",
  })

  if (!isMounted) {
    return children ? <>{children}</> : null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // 收起行動裝置鍵盤
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      (document.activeElement as HTMLInputElement).blur()
    }
    startTransition(async () => {
      try {
        const nextCode = String(formData.code || "").trim().toUpperCase()
        const nextName = String(formData.name || "").trim()
        const originalCode = String(customer?.code || "").trim().toUpperCase()

        if (!nextCode) {
          throw new Error("客戶編號不可空白")
        }

        if (!nextName) {
          throw new Error("客戶姓名不可空白")
        }

        if (mode === "edit" && originalCode && nextCode !== originalCode) {
          const confirmed = window.confirm(
            `確定要把客戶編號從 ${originalCode} 改成 ${nextCode} 嗎？\n系統會同步更新歷史銷貨與應收資料。`
          )

          if (!confirmed) {
            return
          }
        }

        const payload = {
          code: nextCode,
          name: nextName,
          tel1: formData.tel1 || null,
          tel2: formData.tel2 || null,
          tel3: formData.tel3 || null,
          addr: formData.address || null,
          address: formData.address || null,
        }

        const response = await fetch("/api/offline/customers", {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create"
              ? payload
              : {
                  targetCode: originalCode || nextCode,
                  payload,
                }
          ),
        })

        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || `HTTP ${response.status}`)
        }

        toast({
          title: "成功",
          description: result?.offline ? "已離線儲存，待網路恢復後同步" : mode === "create" ? "客戶新增成功" : "客戶更新成功",
        })
        window.location.reload()
        setIsOpen(false)
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
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                required
              />
              {mode === "edit" && (
                <p className="text-xs text-muted-foreground">
                  可直接改成像 `A001-OLD`，系統會一併同步歷史客戶編號。
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">客戶姓名 *</Label>
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
              id="tel1"              inputMode="tel"              value={formData.tel1}
              onChange={(e) => setFormData({ ...formData, tel1: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tel2">電話2</Label>
            <Input
              id="tel2"              inputMode="tel"              value={formData.tel2}
              onChange={(e) => setFormData({ ...formData, tel2: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tel3">電話3</Label>
            <Input
              id="tel3"              inputMode="tel"              value={formData.tel3}
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
