"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { cn, formatCurrencyOneDecimal } from "@/lib/utils"
import { APCheckMobileCard } from "./ap-check-mobile-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export interface APCheckRecord {
  id: string
  purchaseOrderId: string
  orderNo: string
  orderDate: string | null
  supplierId: string | null
  supplierName: string
  amountDue: number
  paidAmount: number
  checkNo: string | null
  checkBank: string | null
  checkIssueDate: string | null
  dueDate: string | null
  paidAt: string | null
  status: "unpaid" | "partially_paid" | "paid"
  notes: string | null
  createdAt: string
  updatedAt: string
}

type CheckStatusFilter = "all" | "pending" | "overdue" | "cleared" | "bounced"

type CheckStatus = "pending" | "overdue" | "cleared" | "bounced"

const CHECK_STATUS_TAG = "[AP_CHECK_STATUS]"

const appendCheckStatusNote = (existingNotes: string | null | undefined, status: CheckStatus) => {
  const timestamp = new Date().toISOString()
  const entry = `${CHECK_STATUS_TAG}${timestamp}|${status}`
  const base = (existingNotes || "").trim()
  return base ? `${base}\n${entry}` : entry
}

const parseLatestCheckStatus = (notes: string | null | undefined): CheckStatus | null => {
  if (!notes) return null

  const entries = notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(CHECK_STATUS_TAG))
    .map((line) => line.replace(CHECK_STATUS_TAG, ""))
    .map((line) => {
      const [at, status] = line.split("|")
      return {
        at: at || "",
        status: (status || "") as CheckStatus,
      }
    })
    .filter((entry) => Boolean(entry.at) && ["pending", "overdue", "cleared", "bounced"].includes(entry.status))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return entries[0]?.status || null
}

const deriveCheckStatus = (record: APCheckRecord): CheckStatus => {
  const latestStatus = parseLatestCheckStatus(record.notes)

  if (latestStatus === "bounced") {
    return "bounced"
  }

  if (record.status === "paid" || (record.paidAmount > 0 && record.paidAmount >= record.amountDue)) {
    return "cleared"
  }

  const dueDateTime = record.dueDate ? new Date(record.dueDate).getTime() : NaN
  if (!Number.isNaN(dueDateTime) && dueDateTime < Date.now()) {
    return "overdue"
  }

  return "pending"
}

const statusLabel: Record<CheckStatus, string> = {
  pending: "待兌現",
  overdue: "到期未兌現",
  cleared: "已兌現",
  bounced: "退票",
}

export function APChecksTable({ records }: { records: APCheckRecord[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<CheckStatusFilter>("all")
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null)
  const [editingCheckNo, setEditingCheckNo] = useState("")
  const [editingCheckBank, setEditingCheckBank] = useState("")
  const [editingCheckIssueDate, setEditingCheckIssueDate] = useState("")
  const [editingDueDate, setEditingDueDate] = useState("")
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<(typeof checkRows)[number] | null>(null)
  const [isPending, startTransition] = useTransition()
  const linkedSupplierId = searchParams.get("supplierId")
  const linkedOrderIds = new Set(
    (searchParams.get("purchaseOrderIds") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const isLinkedFromAP = searchParams.get("source") === "ap"

  const upsertPayableWithFallback = async (
    record: (typeof checkRows)[number],
    payload: Record<string, unknown>,
  ) => {
    const supabase = createClient()

    const executeWrite = async (writePayload: Record<string, unknown>) => {
      if (record.id.startsWith("virtual-")) {
        const { error: insertError } = await supabase.from("accounts_payable").insert({
          purchase_order_id: record.purchaseOrderId,
          ...writePayload,
        })

        if (insertError) {
          throw new Error(insertError.message || "無法建立支票資料")
        }

        return
      }

      const { error: updateError } = await supabase
        .from("accounts_payable")
        .update(writePayload)
        .eq("id", record.id)

      if (updateError) {
        throw new Error(updateError.message || "無法更新支票資料")
      }
    }

    try {
      await executeWrite(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const retryPayload = { ...payload }
      let shouldRetry = false

      const missingColumnMap: Array<{ token: string; field: string }> = [
        { token: "'notes' column", field: "notes" },
        { token: "'check_no' column", field: "check_no" },
        { token: "'check_bank' column", field: "check_bank" },
        { token: "'check_issue_date' column", field: "check_issue_date" },
      ]

      for (const item of missingColumnMap) {
        if (message.includes(item.token) && item.field in retryPayload) {
          delete retryPayload[item.field]
          shouldRetry = true
        }
      }

      if (!shouldRetry) {
        throw error
      }

      await executeWrite(retryPayload)
    }
  }

  const checkRows = useMemo(() => {
    return records
      .map((record) => {
        const checkStatus = deriveCheckStatus(record)
        return {
          ...record,
          checkStatus,
          outstanding: Math.max(0, record.amountDue - record.paidAmount),
        }
      })
      .filter((record) => {
        const keyword = search.trim().toLowerCase()
        const matchesKeyword =
          !keyword ||
          record.supplierName.toLowerCase().includes(keyword) ||
          record.orderNo.toLowerCase().includes(keyword) ||
          (record.checkNo || "").toLowerCase().includes(keyword) ||
          (record.checkBank || "").toLowerCase().includes(keyword)

        const matchesFilter = filter === "all" ? true : record.checkStatus === filter

        const matchesLinkedContext = (() => {
          if (!isLinkedFromAP) return true

          if (linkedOrderIds.size > 0) {
            return linkedOrderIds.has(record.purchaseOrderId)
          }

          if (linkedSupplierId) {
            return record.supplierId === linkedSupplierId
          }

          return true
        })()

        return matchesKeyword && matchesFilter && matchesLinkedContext
      })
      .sort((a, b) => {
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : 0
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : 0
        return bDue - aDue
      })
  }, [records, search, filter, isLinkedFromAP, linkedOrderIds, linkedSupplierId])

  const summary = useMemo(() => {
    return checkRows.reduce(
      (acc, row) => {
        acc.amountDue += row.amountDue
        acc.paidAmount += row.paidAmount
        acc.outstanding += row.outstanding
        acc[row.checkStatus] += 1
        return acc
      },
      {
        amountDue: 0,
        paidAmount: 0,
        outstanding: 0,
        pending: 0,
        overdue: 0,
        cleared: 0,
        bounced: 0,
      },
    )
  }, [checkRows])

  const updateCheck = (record: (typeof checkRows)[number], nextStatus: CheckStatus) => {
    setProcessingId(record.id)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const now = new Date().toISOString()

        const writePayload: Record<string, unknown> = {
          supplier_id: record.supplierId,
          amount_due: record.amountDue,
          total_amount: record.amountDue,
          check_no: record.checkNo,
          check_bank: record.checkBank,
          check_issue_date: record.checkIssueDate,
          due_date: record.dueDate,
          notes: appendCheckStatusNote(record.notes, nextStatus),
        }

        if (nextStatus === "cleared") {
          writePayload.paid_amount = record.amountDue
          writePayload.status = "paid"
          writePayload.paid_at = now
        } else {
          writePayload.paid_amount = 0
          writePayload.status = "unpaid"
          writePayload.paid_at = null
        }

        await upsertPayableWithFallback(record, writePayload)

        const shouldPaid = nextStatus === "cleared"
        const { error: purchaseUpdateError } = await supabase
          .from("purchase_orders")
          .update({ is_paid: shouldPaid })
          .eq("id", record.purchaseOrderId)

        if (purchaseUpdateError) {
          throw new Error(purchaseUpdateError.message || "無法同步進貨付款狀態")
        }

        toast({ title: "成功", description: `已更新為「${statusLabel[nextStatus]}」` })
        router.refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : "更新支票狀態失敗"
        toast({
          title: "錯誤",
          description:
            message.includes("check_no") || message.includes("check_bank") || message.includes("check_issue_date")
              ? "請先執行 scripts/028-add-ap-check-fields.sql，再重新整理頁面"
              : message,
          variant: "destructive",
        })
      } finally {
        setProcessingId(null)
      }
    })
  }

  const openEditCheckDialog = (record: (typeof checkRows)[number]) => {
    setEditingCheckId(record.id)
    setEditingCheckNo(record.checkNo || "")
    setEditingCheckBank(record.checkBank || "")
    setEditingCheckIssueDate(record.checkIssueDate || "")
    setEditingDueDate(record.dueDate || "")
  }

  const closeEditCheckDialog = () => {
    if (isPending) return
    setEditingCheckId(null)
    setEditingCheckNo("")
    setEditingCheckBank("")
    setEditingCheckIssueDate("")
    setEditingDueDate("")
  }

  const saveCheckMeta = () => {
    const record = checkRows.find((row) => row.id === editingCheckId)
    if (!record) return

    setProcessingId(record.id)

    startTransition(async () => {
      try {
        const supabase = createClient()

        const writePayload: Record<string, unknown> = {
          supplier_id: record.supplierId,
          amount_due: record.amountDue,
          total_amount: record.amountDue,
          paid_amount: record.paidAmount,
          paid_at: record.paidAt,
          due_date: editingDueDate || null,
          status: record.status,
          notes: record.notes,
          check_no: editingCheckNo.trim() || null,
          check_bank: editingCheckBank.trim() || null,
          check_issue_date: editingCheckIssueDate || null,
        }

        await upsertPayableWithFallback(record, writePayload)

        toast({ title: "成功", description: "已儲存支票資料" })
        closeEditCheckDialog()
        router.refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : "儲存支票資料失敗"
        toast({
          title: "錯誤",
          description:
            message.includes("check_no") || message.includes("check_bank") || message.includes("check_issue_date")
              ? "請先執行 scripts/028-add-ap-check-fields.sql，再重新整理頁面"
              : message,
          variant: "destructive",
        })
      } finally {
        setProcessingId(null)
      }
    })
  }

  const handleDeleteCheck = () => {
    if (!deleteTarget) return
    setProcessingId(deleteTarget.id)
    setShowDeleteDialog(false)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase
          .from("accounts_payable")
          .delete()
          .eq("id", deleteTarget.id)
        if (error) throw new Error(error.message || "刪除失敗")
        toast({ title: "成功", description: "已刪除支票資料" })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "刪除支票資料失敗",
          variant: "destructive",
        })
      } finally {
        setProcessingId(null)
        setDeleteTarget(null)
      }
    })
  }

  const clearLegacyDueDates = () => {
    const targets = records.filter((record) => {
      if (record.id.startsWith("virtual-")) return false
      if (!record.dueDate || !record.orderDate) return false

      const hasCheckMeta = Boolean(record.checkNo || record.checkBank || record.checkIssueDate)
      if (hasCheckMeta) return false

      return record.dueDate === record.orderDate
    })

    if (targets.length === 0) {
      toast({ title: "提示", description: "沒有符合條件的舊到期日資料" })
      return
    }

    startTransition(async () => {
      try {
        const supabase = createClient()

        for (const target of targets) {
          const { error } = await supabase
            .from("accounts_payable")
            .update({ due_date: null })
            .eq("id", target.id)

          if (error) {
            throw new Error(error.message || "批次清空到期日失敗")
          }
        }

        toast({ title: "成功", description: `已清空 ${targets.length} 筆舊到期日` })
        router.refresh()
      } catch (error) {
        toast({
          title: "錯誤",
          description: error instanceof Error ? error.message : "批次清空到期日失敗",
          variant: "destructive",
        })
      }
    })
  }

  const statusBadge = (status: CheckStatus) => {
    if (status === "cleared") return <Badge>{statusLabel[status]}</Badge>
    if (status === "overdue") return <Badge variant="destructive">{statusLabel[status]}</Badge>
    if (status === "bounced") return <Badge variant="outline">{statusLabel[status]}</Badge>
    return <Badge variant="secondary">{statusLabel[status]}</Badge>
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋供應商、進貨單號"
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          {([
            ["all", "全部"],
            ["pending", "待兌現"],
            ["overdue", "到期未兌現"],
            ["bounced", "退票"],
            ["cleared", "已兌現"],
          ] as Array<[CheckStatusFilter, string]>).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={clearLegacyDueDates} disabled={isPending}>
            清空舊到期日
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">應付合計</p>
          <p className="text-2xl font-semibold">{formatCurrencyOneDecimal(summary.amountDue)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">已付金額</p>
          <p className="text-2xl font-semibold">{formatCurrencyOneDecimal(summary.paidAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground mb-1">未付金額</p>
          <p className="text-2xl font-semibold text-destructive">{formatCurrencyOneDecimal(summary.outstanding)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>待兌現 {summary.pending}</span>
        <span>・</span>
        <span className="text-destructive">到期未兌現 {summary.overdue}</span>
        <span>・</span>
        <span>退票 {summary.bounced}</span>
        <span>・</span>
        <span>已兌現 {summary.cleared}</span>
      </div>

      {isLinkedFromAP && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">已從應付帳款帶入支票付款資料</span>
          <Button variant="outline" size="sm" onClick={() => router.push("/accounts-payable/checks")}>查看全部</Button>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>供應商</TableHead>
              <TableHead>進貨單號</TableHead>
              <TableHead>支票號碼</TableHead>
              <TableHead>銀行</TableHead>
              <TableHead>開票日</TableHead>
              <TableHead>到期日</TableHead>
              <TableHead className="text-right">應付</TableHead>
              <TableHead className="text-right">已付</TableHead>
              <TableHead className="text-right">未付</TableHead>
              <TableHead>支票狀態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checkRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                  查無符合條件的支票資料
                </TableCell>
              </TableRow>
            ) : (
              checkRows.map((row) => {
                const isRowPending = processingId === row.id && isPending

                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.supplierName}</TableCell>
                    <TableCell>{row.orderNo}</TableCell>
                    <TableCell>{row.checkNo || "-"}</TableCell>
                    <TableCell>{row.checkBank || "-"}</TableCell>
                    <TableCell>{row.checkIssueDate ? new Date(row.checkIssueDate).toLocaleDateString("zh-TW") : "-"}</TableCell>
                    <TableCell>
                      {row.dueDate ? new Date(row.dueDate).toLocaleDateString("zh-TW") : "-"}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.amountDue)}</TableCell>
                    <TableCell className="text-right">{formatCurrencyOneDecimal(row.paidAmount)}</TableCell>
                    <TableCell className="text-right text-destructive">{formatCurrencyOneDecimal(row.outstanding)}</TableCell>
                    <TableCell>{statusBadge(row.checkStatus)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-2 w-48">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isRowPending}
                          onClick={() => openEditCheckDialog(row)}
                        >
                          編輯資料
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(row.checkStatus === "pending" && "bg-accent")}
                          disabled={isRowPending}
                          onClick={() => updateCheck(row, "pending")}
                        >
                          待兌現
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isRowPending}
                          onClick={() => updateCheck(row, "bounced")}
                        >
                          退票
                        </Button>
                        <Button
                          size="sm"
                          disabled={isRowPending}
                          onClick={() => updateCheck(row, "cleared")}
                        >
                          已兌現
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isRowPending}
                          onClick={() => {
                            setDeleteTarget(row)
                            setShowDeleteDialog(true)
                          }}
                        >
                          刪除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(editingCheckId)} onOpenChange={(open) => !open && closeEditCheckDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯支票資料</DialogTitle>
            <DialogDescription>可維護支票號碼、銀行、開票日與到期日</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ap-check-no">支票號碼</Label>
              <Input
                id="ap-check-no"
                value={editingCheckNo}
                onChange={(event) => setEditingCheckNo(event.target.value)}
                placeholder="請輸入支票號碼"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ap-check-bank">銀行</Label>
              <Input
                id="ap-check-bank"
                value={editingCheckBank}
                onChange={(event) => setEditingCheckBank(event.target.value)}
                placeholder="請輸入銀行名稱"
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ap-check-issue-date">開票日</Label>
                <Input
                  id="ap-check-issue-date"
                  type="date"
                  value={editingCheckIssueDate}
                  onChange={(event) => setEditingCheckIssueDate(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ap-check-due-date">到期日</Label>
                <Input
                  id="ap-check-due-date"
                  type="date"
                  value={editingDueDate}
                  onChange={(event) => setEditingDueDate(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditCheckDialog} disabled={isPending}>
              取消
            </Button>
            <Button onClick={saveCheckMeta} disabled={isPending || !editingCheckId}>
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>刪除支票資料</DialogTitle>
            <DialogDescription>此操作無法還原，請確認是否刪除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isPending}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDeleteCheck} disabled={isPending || !deleteTarget}>
              確認刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
