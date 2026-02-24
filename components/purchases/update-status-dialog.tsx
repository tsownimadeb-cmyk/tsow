"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
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
import { createClient } from "@/lib/supabase/client"
import type { PurchaseOrder, SalesOrder } from "@/lib/types"

interface UpdateStatusDialogProps {
  order: PurchaseOrder | SalesOrder
  newStatus: "completed" | "cancelled"
  type: "purchase" | "sales"
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UpdateStatusDialog({ order, newStatus, type, open, onOpenChange }: UpdateStatusDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const statusLabels = {
    completed: "已完成",
    cancelled: "已取消",
  }

  const handleUpdate = () => {
    const supabase = createClient()
    const tableName = type === "purchase" ? "purchase_orders" : "sales_orders"

    startTransition(async () => {
      await supabase.from(tableName).update({ status: newStatus }).eq("id", order.id)

      // 如果是完成進貨單，更新庫存
      if (type === "purchase" && newStatus === "completed") {
        const { data: items } = await supabase
          .from("purchase_order_items")
          .select("*")
          .eq("purchase_order_id", order.id)

        if (items) {
          for (const item of items) {
            if (item.product_id) {
              const { data: product } = await supabase
                .from("products")
                .select("stock_quantity")
                .eq("id", item.product_id)
                .single()

              if (product) {
                await supabase
                  .from("products")
                  .update({ stock_quantity: product.stock_quantity + item.quantity })
                  .eq("id", item.product_id)
              }
            }
          }
        }
      }

      // 如果是完成銷貨單，扣減庫存
      if (type === "sales" && newStatus === "completed") {
        const { data: items } = await supabase.from("sales_order_items").select("*").eq("sales_order_id", order.id)

        if (items) {
          for (const item of items) {
            if (item.product_id) {
              const { data: product } = await supabase
                .from("products")
                .select("stock_quantity")
                .eq("id", item.product_id)
                .single()

              if (product) {
                await supabase
                  .from("products")
                  .update({ stock_quantity: Math.max(0, product.stock_quantity - item.quantity) })
                  .eq("id", item.product_id)
              }
            }
          }
        }
      }

      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確認更新狀態</AlertDialogTitle>
          <AlertDialogDescription>
            您確定要將單號「{order.order_number}」的狀態更新為「{statusLabels[newStatus]}」嗎？
            {newStatus === "completed" && type === "purchase" && "完成後將自動增加商品庫存。"}
            {newStatus === "completed" && type === "sales" && "完成後將自動扣減商品庫存。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleUpdate} disabled={isPending}>
            {isPending ? "更新中..." : "確認"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
