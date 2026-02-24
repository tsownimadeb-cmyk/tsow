"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import type { PurchaseOrder } from "@/lib/types"

interface PurchaseDetailDialogProps {
  purchase: PurchaseOrder
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusMap = {
  pending: { label: "待處理", variant: "secondary" as const },
  completed: { label: "已完成", variant: "default" as const },
  cancelled: { label: "已取消", variant: "destructive" as const },
}

export function PurchaseDetailDialog({ purchase, open, onOpenChange }: PurchaseDetailDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const status = statusMap[purchase.status]

  const handleTogglePaid = () => {
    startTransition(async () => {
      try {
        const supabase = createClient()
        const newStatus = !purchase.is_paid

        const { error: purchaseError } = await supabase
          .from("purchase_orders")
          .update({ is_paid: newStatus })
          .eq("id", purchase.id)

        if (purchaseError) {
          toast({
            title: "錯誤",
            description: purchaseError.message || "無法更新進貨付款狀態",
            variant: "destructive",
          })
          return
        }

        const { data: existingApRows, error: apQueryError } = await supabase
          .from("accounts_payable")
          .select("id")
          .eq("purchase_order_id", purchase.id)
          .limit(1)

        if (apQueryError) {
          toast({
            title: "錯誤",
            description: apQueryError.message || "無法查詢應付帳款",
            variant: "destructive",
          })
          return
        }

        const apPayload = {
          supplier_id: purchase.supplier_id,
          amount_due: Number(purchase.total_amount),
          total_amount: Number(purchase.total_amount),
          paid_amount: newStatus ? Number(purchase.total_amount) : 0,
          due_date: purchase.order_date,
          status: newStatus ? "paid" : "unpaid",
        }

        if (existingApRows && existingApRows.length > 0) {
          const { error: apUpdateError } = await supabase
            .from("accounts_payable")
            .update(apPayload)
            .eq("id", existingApRows[0].id)

          if (apUpdateError) {
            toast({
              title: "錯誤",
              description: apUpdateError.message || "無法更新應付帳款",
              variant: "destructive",
            })
            return
          }
        } else {
          const { error: apInsertError } = await supabase.from("accounts_payable").insert({
            purchase_order_id: purchase.id,
            ...apPayload,
          })

          if (apInsertError) {
            toast({
              title: "錯誤",
              description: apInsertError.message || "無法建立應付帳款",
              variant: "destructive",
            })
            return
          }
        }

        toast({
          title: "成功",
          description: newStatus ? "已標記為已付款" : "已標記為未付款",
        })
        router.refresh()
        onOpenChange(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>進貨單明細</DialogTitle>
          <DialogDescription>單號：{purchase.order_number}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">供應商：</span>
              <span className="ml-2 font-medium">{purchase.supplier?.name || "-"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">日期：</span>
              <span className="ml-2 font-medium">{new Date(purchase.order_date).toLocaleDateString("zh-TW")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">狀態：</span>
              <Badge variant={status.variant} className="ml-2">
                {status.label}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">總金額：</span>
              <span className="ml-2 font-medium">${Number(purchase.total_amount).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">付款狀態：</span>
              <div className="ml-2 inline-flex items-center gap-2">
                {purchase.is_paid ? (
                  <Badge variant="default" className="gap-1">
                    <Check className="h-3 w-3" />
                    已付款
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <X className="h-3 w-3" />
                    未付款
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePaid}
                  disabled={isPending}
                  className="h-7"
                >
                  {isPending ? "更新中..." : "修改"}
                </Button>
              </div>
            </div>
          </div>

          {purchase.notes && (
            <div className="text-sm">
              <span className="text-muted-foreground">備註：</span>
              <p className="mt-1">{purchase.notes}</p>
            </div>
          )}

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品</TableHead>
                  <TableHead className="text-right">數量</TableHead>
                  <TableHead className="text-right">單價</TableHead>
                  <TableHead className="text-right">小計</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items?.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.product?.pname || "-"}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">${Number(item.unit_price).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(item.subtotal).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
