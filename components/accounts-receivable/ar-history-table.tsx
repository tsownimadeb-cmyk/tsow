"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
const PAGE_SIZE = 20
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface ReceiptRecord {
  id: string
  ar_id: string | null
  sales_order_id: string | null
  payment_date: string | null
  customer_name: string | null
  customer_cno: string | null
  order_no: string | null
  payment_method: string | null
  check_no: string | null
  check_due_date: string | null
  payment_amount: number | null
  notes: string | null
  created_at: string | null
}

type PaymentMethod = "現金" | "匯款" | "支票"

type EditFormState = {
  payment_date: string
  payment_method: PaymentMethod
  payment_amount: string
  check_no: string
  check_due_date: string
  notes: string
}

const EMPTY_EDIT_FORM: EditFormState = {
  payment_date: "",
  payment_method: "現金",
  payment_amount: "",
  check_no: "",
  check_due_date: "",
  notes: "",
}

type Props = {
  initialRecords: ReceiptRecord[]
}

export function ARHistoryTable({ initialRecords }: Props) {
  // 將格式化備註的邏輯移到 client component 內部
  const INTERNAL_NOTE_PREFIXES = ["[AR_PAYMENT]", "[AR_CHECK_LINKED]", "[AR_CHECK_STATUS]", "[PARTIAL_SETTLEMENT]"]
  const formatReceiptNotes = (notes: string | null) => {
    const visibleLines = String(notes || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !INTERNAL_NOTE_PREFIXES.some((prefix) => line.startsWith(prefix)))
    return visibleLines.length > 0 ? visibleLines.join("\n") : "-"
  }
  const router = useRouter()
  const { toast } = useToast()
  const [records, setRecords] = useState<ReceiptRecord[]>(initialRecords)
  const [page, setPage] = useState(1)
  const [openGroupKey, setOpenGroupKey] = useState("")
  const [editingRecord, setEditingRecord] = useState<ReceiptRecord | null>(null)
  const [deleteRecord, setDeleteRecord] = useState<ReceiptRecord | null>(null)
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM)
  const [isPending, startTransition] = useTransition()

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const dateA = String(a.payment_date || "")
      const dateB = String(b.payment_date || "")
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA)
      }
      return String(b.created_at || "").localeCompare(String(a.created_at || ""))
    })
  }, [records])

  const groupedRecords = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        paymentDate: string
        customerName: string
        customerCno: string
        totalAmount: number
        records: ReceiptRecord[]
      }
    >()

    sortedRecords.forEach((record) => {
      const paymentDate = String(record.payment_date || "-").trim() || "-"
      const customerName = String(record.customer_name || "散客").trim() || "散客"
      const customerCno = String(record.customer_cno || "未指定").trim() || "未指定"
      const key = `${paymentDate}__${customerName}__${customerCno}`

      const existingGroup = groups.get(key)
      if (existingGroup) {
        existingGroup.records.push(record)
        existingGroup.totalAmount += Number(record.payment_amount || 0)
        return
      }

      groups.set(key, {
        key,
        paymentDate,
        customerName,
        customerCno,
        totalAmount: Number(record.payment_amount || 0),
        records: [record],
      })
    })

    return Array.from(groups.values())
  }, [sortedRecords])

  const totalPages = Math.max(1, Math.ceil(groupedRecords.length / PAGE_SIZE))
  const pagedGroups = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return groupedRecords.slice(start, start + PAGE_SIZE)
  }, [groupedRecords, page])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const openEditDialog = (record: ReceiptRecord) => {
    setEditingRecord(record)
    setEditForm({
      payment_date: record.payment_date || "",
      payment_method: record.payment_method === "支票" ? "支票" : record.payment_method === "匯款" ? "匯款" : "現金",
      payment_amount: String(Number(record.payment_amount || 0)),
      check_no: record.check_no || "",
      check_due_date: record.check_due_date || "",
      notes: formatReceiptNotes(record.notes) === "-" ? "" : formatReceiptNotes(record.notes),
    })
  }

  const closeEditDialog = () => {
    setEditingRecord(null)
    setEditForm(EMPTY_EDIT_FORM)
  }

  const updateReceivableByDelta = async (record: ReceiptRecord, deltaAmount: number) => {
    if (!deltaAmount) {
      return { ok: true as const }
    }

    const supabase = createClient()
    let targetRow: {
      id: string
      sales_order_id: string | null
      amount_due: number | null
      paid_amount: number | null
    } | null = null

    if (record.ar_id) {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("id,sales_order_id,amount_due,paid_amount")
        .eq("id", record.ar_id)
        .maybeSingle()

      if (error) {
        return { ok: false as const, error: error.message || "無法取得應收帳款資料" }
      }

      targetRow = data
    }

    if (!targetRow && record.sales_order_id) {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("id,sales_order_id,amount_due,paid_amount")
        .eq("sales_order_id", record.sales_order_id)
        .maybeSingle()

      if (error) {
        return { ok: false as const, error: error.message || "無法取得應收帳款資料" }
      }

      targetRow = data
    }

    if (!targetRow) {
      return { ok: false as const, error: "找不到對應的應收帳款，無法回補未收金額" }
    }

    const amountDue = Math.max(0, Number(targetRow.amount_due || 0))
    const currentPaid = Math.max(0, Math.min(amountDue, Number(targetRow.paid_amount || 0)))
    const nextPaid = Math.max(0, Math.min(amountDue, currentPaid + deltaAmount))
    const nextStatus: "unpaid" | "partially_paid" | "paid" =
      nextPaid <= 0 ? "unpaid" : nextPaid >= amountDue ? "paid" : "partially_paid"

    const { error: arUpdateError } = await supabase
      .from("accounts_receivable")
      .update({
        paid_amount: nextPaid,
        status: nextStatus,
        paid_at: nextPaid > 0 ? new Date().toISOString() : null,
      })
      .eq("id", targetRow.id)

    if (arUpdateError) {
      return { ok: false as const, error: arUpdateError.message || "更新應收帳款金額失敗" }
    }

    if (targetRow.sales_order_id) {
      const { error: salesOrderError } = await supabase
        .from("sales_orders")
        .update({ is_paid: nextStatus === "paid" })
        .eq("id", targetRow.sales_order_id)

      if (salesOrderError) {
        return { ok: false as const, error: salesOrderError.message || "更新銷貨付款狀態失敗" }
      }
    }

    return { ok: true as const }
  }

  const handleEditSubmit = () => {
    if (!editingRecord) {
      return
    }

    const nextPaymentAmount = Number(editForm.payment_amount)
    if (!editForm.payment_date) {
      toast({ title: "錯誤", description: "請輸入收款日期", variant: "destructive" })
      return
    }
    if (!Number.isFinite(nextPaymentAmount) || nextPaymentAmount <= 0) {
      toast({ title: "錯誤", description: "收款金額必須大於 0", variant: "destructive" })
      return
    }
    if (editForm.payment_method === "支票" && !editForm.check_due_date) {
      toast({ title: "錯誤", description: "支票收款需填寫支票到期日", variant: "destructive" })
      return
    }

    startTransition(async () => {
      const previousPaymentAmount = Number(editingRecord.payment_amount || 0)
      const delta = nextPaymentAmount - previousPaymentAmount
      const receivableResult = await updateReceivableByDelta(editingRecord, delta)

      if (!receivableResult.ok) {
        toast({ title: "錯誤", description: receivableResult.error, variant: "destructive" })
        return
      }

      const supabase = createClient()
      const nextIsCheck = editForm.payment_method === "支票"
      const payload = {
        payment_date: editForm.payment_date,
        payment_method: editForm.payment_method,
        payment_amount: nextPaymentAmount,
        check_no: nextIsCheck ? editForm.check_no || null : null,
        check_due_date: nextIsCheck ? editForm.check_due_date || null : null,
        notes: editForm.notes.trim() ? editForm.notes.trim() : null,
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase.from("ar_receipts").update(payload).eq("id", editingRecord.id)

      if (error) {
        await updateReceivableByDelta(editingRecord, -delta)
        toast({ title: "錯誤", description: error.message || "更新收款履歷失敗", variant: "destructive" })
        return
      }

      setRecords((prev) =>
        prev.map((item) =>
          item.id === editingRecord.id
            ? {
                ...item,
                ...payload,
              }
            : item,
        ),
      )
      closeEditDialog()
      toast({ title: "成功", description: "收款履歷已更新" })
      router.refresh()
    })
  }

  const handleDelete = () => {
    if (!deleteRecord) {
      return
    }

    startTransition(async () => {
      const paymentAmount = Number(deleteRecord.payment_amount || 0)
      const receivableResult = await updateReceivableByDelta(deleteRecord, -paymentAmount)

      // 若找不到對應 AR 記錄（例如已先執行「恢復未付款」），
      // 允許繼續刪除收款履歷；若是其他資料庫錯誤才阻擋。
      const arNotFound =
        !receivableResult.ok &&
        typeof (receivableResult as { error?: string }).error === "string" &&
        (receivableResult as { error: string }).error.includes("找不到對應的應收帳款")

      if (!receivableResult.ok && !arNotFound) {
        toast({ title: "錯誤", description: (receivableResult as { error: string }).error, variant: "destructive" })
        return
      }

      const supabase = createClient()
      const { error } = await supabase.from("ar_receipts").delete().eq("id", deleteRecord.id)

      if (error) {
        // 若之前 AR 更新成功，回補差額；若找不到 AR 則不回補
        if (!arNotFound) {
          await updateReceivableByDelta(deleteRecord, paymentAmount)
        }
        toast({ title: "錯誤", description: error.message || "刪除收款履歷失敗", variant: "destructive" })
        return
      }

      setRecords((prev) => prev.filter((item) => item.id !== deleteRecord.id))
      setDeleteRecord(null)
      toast({
        title: "成功",
        description: arNotFound
          ? "收款履歷已刪除（應收帳款已於先前恢復未付款，無需再回補）"
          : "收款履歷已刪除，並回補未收金額",
      })
      router.refresh()
    })
  }

  return (
    <>
      <div className="rounded-lg border bg-card">
        {pagedGroups.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">目前尚無收款履歷資料</div>
        ) : (
          <Accordion type="single" collapsible className="w-full" onValueChange={(value) => setOpenGroupKey(value)}>
            {pagedGroups.map((group) => {
              const isExpanded = openGroupKey === group.key
              return (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="w-full space-y-1 text-left">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-semibold">{group.customerName}</span>
                        <span className="text-xs text-muted-foreground">{group.customerCno}・{group.records.length} 筆收款</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                        <span>收款日期 {group.paymentDate}</span>
                        <span className={isExpanded ? "text-foreground" : "text-primary"}>實收合計 {group.totalAmount.toLocaleString("zh-TW")}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <div className="overflow-x-auto rounded-md border">
                      <table className="hidden min-w-full text-sm sm:table">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="border px-2 py-2">對應單號</th>
                            <th className="border px-2 py-2">收款方式</th>
                            <th className="border px-2 py-2">支票號碼</th>
                            <th className="border px-2 py-2">支票到期日</th>
                            <th className="border px-2 py-2 text-right">實收金額</th>
                            <th className="border px-2 py-2">備註</th>
                            <th className="border px-2 py-2 text-center">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.records.map((rec) => {
                            const isCheckPayment = rec.payment_method === "支票"
                            return (
                              <tr key={rec.id}>
                                <td className="border px-2 py-1">{rec.order_no || "-"}</td>
                                <td className="border px-2 py-1">{rec.payment_method || "-"}</td>
                                <td className="border px-2 py-1">{isCheckPayment ? rec.check_no || "-" : "-"}</td>
                                <td className="border px-2 py-1">{isCheckPayment ? rec.check_due_date || "-" : "-"}</td>
                                <td className="border px-2 py-1 text-right">{Number(rec.payment_amount || 0).toLocaleString("zh-TW")}</td>
                                <td className="border px-2 py-1 whitespace-pre-line">{formatReceiptNotes(rec.notes)}</td>
                                <td className="border px-2 py-1 text-center">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button type="button" size="sm" variant="outline" disabled={isPending}>
                                        操作
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => openEditDialog(rec)} disabled={isPending}>
                                        修改
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => setDeleteRecord(rec)} disabled={isPending} variant="destructive">
                                        刪除
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </td>
                              </tr>
                            )
                          })}
                          <tr className="bg-muted/40">
                            <td className="border px-2 py-2 text-right font-semibold" colSpan={4}>合計</td>
                            <td className="border px-2 py-2 text-right font-semibold text-primary">{group.totalAmount.toLocaleString("zh-TW")}</td>
                            <td className="border px-2 py-2" colSpan={2} />
                          </tr>
                        </tbody>
                      </table>

                      <div className="space-y-2 p-2 sm:hidden">
                        {group.records.map((rec) => {
                          const isCheckPayment = rec.payment_method === "支票"
                          return (
                            <div key={rec.id} className="rounded-md border bg-background p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">對應單號</span>
                                <span className="font-medium">{rec.order_no || "-"}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground">收款方式</p>
                                  <p>{rec.payment_method || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">實收金額</p>
                                  <p className="font-semibold text-primary">{Number(rec.payment_amount || 0).toLocaleString("zh-TW")}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">支票號碼</p>
                                  <p>{isCheckPayment ? rec.check_no || "-" : "-"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">支票到期日</p>
                                  <p>{isCheckPayment ? rec.check_due_date || "-" : "-"}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">備註</p>
                                <p className="whitespace-pre-line text-sm">{formatReceiptNotes(rec.notes)}</p>
                              </div>
                              <div className="flex justify-end">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button type="button" size="sm" variant="outline" disabled={isPending}>
                                      操作
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openEditDialog(rec)} disabled={isPending}>
                                      修改
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setDeleteRecord(rec)} disabled={isPending} variant="destructive">
                                      刪除
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          )
                        })}
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-right text-sm font-semibold">
                          合計 {group.totalAmount.toLocaleString("zh-TW")}
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        )}
      </div>

      {/* 分頁控制 */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          共 {sortedRecords.length} 筆收款（{groupedRecords.length} 組），頁次 {page} / {totalPages}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            上一頁
          </Button>
          {Array.from({ length: totalPages }, (_, i) => (
            <Button
              key={i + 1}
              type="button"
              size="sm"
              variant={page === i + 1 ? "default" : "outline"}
              onClick={() => setPage(i + 1)}
              disabled={page === i + 1}
            >
              {i + 1}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            下一頁
          </Button>
        </div>
      </div>

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改收款履歷</DialogTitle>
            <DialogDescription>可修正收款日期、方式、金額與備註。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="payment_date">收款日期</Label>
              <Input
                id="payment_date"
                type="date"
                value={editForm.payment_date}
                onChange={(event) => setEditForm((prev) => ({ ...prev, payment_date: event.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>收款方式</Label>
              <Select
                value={editForm.payment_method}
                onValueChange={(value: PaymentMethod) => {
                  setEditForm((prev) => ({
                    ...prev,
                    payment_method: value,
                    check_no: value === "支票" ? prev.check_no : "",
                    check_due_date: value === "支票" ? prev.check_due_date : "",
                  }))
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇收款方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="現金">現金</SelectItem>
                  <SelectItem value="匯款">匯款</SelectItem>
                  <SelectItem value="支票">支票</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editForm.payment_method === "支票" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="check_no">支票號碼</Label>
                  <Input
                    id="check_no"
                    value={editForm.check_no}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, check_no: event.target.value }))}
                    placeholder="請輸入支票號碼"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="check_due_date">支票到期日</Label>
                  <Input
                    id="check_due_date"
                    type="date"
                    value={editForm.check_due_date}
                    onChange={(event) => setEditForm((prev) => ({ ...prev, check_due_date: event.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="grid gap-2">
              <Label htmlFor="payment_amount">收款金額</Label>
              <Input
                id="payment_amount"
                type="number"
                min="0"
                step="0.01"
                value={editForm.payment_amount}
                onChange={(event) => setEditForm((prev) => ({ ...prev, payment_amount: event.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">備註</Label>
              <Textarea
                id="notes"
                value={editForm.notes}
                onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="可輸入補充說明"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditDialog} disabled={isPending}>
              取消
            </Button>
            <Button type="button" onClick={handleEditSubmit} disabled={isPending}>
              {isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteRecord)} onOpenChange={(open) => !open && setDeleteRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認刪除收款履歷</AlertDialogTitle>
            <AlertDialogDescription>
              刪除後會回補該筆應收帳款的未收金額，且此動作無法復原。是否繼續？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "刪除中..." : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
