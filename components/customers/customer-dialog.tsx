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
import { createClient } from "@/lib/supabase/client"
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

const CUSTOMER_REFERENCE_TABLES = [
  { table: "sales_orders", columns: ["customer_cno"] },
  { table: "accounts_receivable", columns: ["customer_cno"] },
  { table: "sales_returns", columns: ["customer_cno", "customer_code"] },
  { table: "ar_receipts", columns: ["customer_cno"] },
] as const

function isMissingRenameRpcError(message: string) {
  return /Could not find the function|does not exist|schema cache/i.test(message)
}

function isSkippableReferenceSyncError(message: string) {
  return /column .* does not exist|relation .* does not exist|Could not find the .* column .* in the schema cache|Could not find the table .* in the schema cache/i.test(
    message
  )
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
    const supabase = createClient()

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

        const sampleResult = await supabase.from("customers").select("*").limit(1)
        if (sampleResult.error) {
          throw new Error(sampleResult.error.message || "讀取 customers 欄位失敗")
        }

        const existingColumns = new Set<string>(Object.keys((sampleResult.data || [])[0] || {}))
        const hasColumn = (column: string) => existingColumns.has(column)

        const keyColumn = "code"
        const legacyCodeColumn = hasColumn("cno") ? "cno" : null
        const nameColumn = "name"
        const tel1Column = hasColumn("tel1") ? "tel1" : null
        const tel2Column = hasColumn("tel2") ? "tel2" : hasColumn("tel11") ? "tel11" : null
        const tel3Column = hasColumn("fax") ? "fax" : hasColumn("tel3") ? "tel3" : hasColumn("tel12") ? "tel12" : null
        const addressColumn = hasColumn("addr") ? "addr" : hasColumn("address") ? "address" : null

        const payload: Record<string, string | null> = {
          [nameColumn]: nextName,
        }

        if (tel1Column) payload[tel1Column] = formData.tel1 || null
        if (tel2Column) payload[tel2Column] = formData.tel2 || null
        if (tel3Column) payload[tel3Column] = formData.tel3 || null
        if (addressColumn) payload[addressColumn] = formData.address || null

        let error
        if (mode === "create") {
          const insertPayload: Record<string, string | null> = {
            [keyColumn]: nextCode,
            ...payload,
          }

          if (legacyCodeColumn) {
            insertPayload[legacyCodeColumn] = nextCode
          }

          const result = await supabase.from("customers").insert(insertPayload)
          error = result.error
        } else if (customer) {
          const codeChanged = nextCode !== originalCode

          if (codeChanged) {
            const duplicateResult = await supabase
              .from("customers")
              .select(keyColumn)
              .eq(keyColumn, nextCode)
              .maybeSingle()

            if (duplicateResult.error && duplicateResult.error.code !== "PGRST116") {
              throw new Error(duplicateResult.error.message || "檢查客戶編號失敗")
            }

            if (duplicateResult.data) {
              throw new Error(`客戶編號 ${nextCode} 已存在，請改用其他編號`)
            }

            const rpcResult = await supabase.rpc("rename_customer_code", {
              p_old_code: originalCode,
              p_new_code: nextCode,
            })

            if (rpcResult.error && !isMissingRenameRpcError(rpcResult.error.message || "")) {
              throw new Error(rpcResult.error.message || "同步客戶編號失敗")
            }

            if (rpcResult.error) {
              const keyUpdatePayload: Record<string, string> = {
                [keyColumn]: nextCode,
              }

              if (legacyCodeColumn) {
                keyUpdatePayload[legacyCodeColumn] = nextCode
              }

              const renameCustomerResult = await supabase
                .from("customers")
                .update(keyUpdatePayload)
                .eq(keyColumn, originalCode)

              if (renameCustomerResult.error) {
                throw new Error(renameCustomerResult.error.message || "更新客戶編號失敗")
              }

              for (const ref of CUSTOMER_REFERENCE_TABLES) {
                for (const column of ref.columns) {
                  const refResult = await supabase
                    .from(ref.table)
                    .update({ [column]: nextCode } as never)
                    .eq(column, originalCode)

                  const refMessage = refResult.error?.message || ""
                  if (!refResult.error) {
                    break
                  }

                  if (isSkippableReferenceSyncError(refMessage)) {
                    continue
                  }

                  throw new Error(`同步 ${ref.table} 失敗：${refMessage}`)
                }

              }
            }
          }

          const result = await supabase
            .from("customers")
            .update(payload)
            .eq(keyColumn, codeChanged ? nextCode : originalCode)

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
