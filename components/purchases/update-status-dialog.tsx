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
import { useToast } from "@/hooks/use-toast"
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
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const toastApi = {
    error: (message: string) => {
      toast({
        title: "錯誤",
        description: message,
        variant: "destructive",
      })
    },
  }

  const statusLabels = {
    completed: "已完成",
    cancelled: "已取消",
  }

  const handleUpdate = () => {
    const supabase = createClient()
    const tableName = type === "purchase" ? "purchase_orders" : "sales_orders"
    const itemsTable = type === "purchase" ? "purchase_order_items" : "sales_order_items"
    const foreignKey = type === "purchase" ? "order_no" : "sales_order_id"
    const foreignValue = type === "purchase" ? order.order_no : order.id

    startTransition(async () => {
      try {
        const { error: updateOrderError } = await supabase.from(tableName).update({ status: newStatus }).eq("id", order.id)
        if (updateOrderError) {
          console.error("[UpdateStatusDialog] 更新主單狀態失敗:", updateOrderError)
          toastApi.error(updateOrderError.message)
          return
        }

        if (newStatus === "completed") {
          if (!foreignValue) {
            throw new Error(type === "purchase" ? "缺少 order_no，無法更新進貨庫存" : "缺少 sales_order_id，無法更新銷貨庫存")
          }

          const { data: items, error: itemsError } = await supabase
            .from(itemsTable)
            .select("id,code,product_code,quantity")
            .eq(foreignKey, foreignValue)

          if (itemsError) {
            console.error("[UpdateStatusDialog] 查詢明細失敗:", itemsError)
            toastApi.error(itemsError.message)
            return
          }

          for (const item of items || []) {
            const productCode = String(item.code || item.product_code || "").trim()
            const quantity = Number(item.quantity ?? 0)
            if (!productCode || !Number.isFinite(quantity) || quantity <= 0) continue

            console.log("正在處理單據:", foreignValue, "商品:", productCode)

            const { data: product, error: productError } = await supabase
              .from("products")
              .select("code,name,price,stock_qty,purchase_qty_total")
              .eq("code", productCode)
              .single()

            if (productError || !product) {
              console.error("[UpdateStatusDialog] 讀取商品失敗:", productError)
              throw new Error(productError?.message || `找不到商品 ${productCode}`)
            }

            const coalescedStockQty = Number(product.stock_qty ?? 0)
            const coalescedPurchaseQtyTotal = Number(product.purchase_qty_total ?? 0)

            if (type === "purchase") {
              const { error: updateProductError } = await supabase
                .from("products")
                .update({
                  stock_qty: coalescedStockQty + quantity,
                  purchase_qty_total: coalescedPurchaseQtyTotal + quantity,
                })
                .eq("code", productCode)

              if (updateProductError) {
                console.error("[UpdateStatusDialog] 更新庫存失敗:", updateProductError)
                throw new Error(updateProductError.message)
              }
            } else {
              const { error: updateProductError } = await supabase
                .from("products")
                .update({ stock_qty: Math.max(0, coalescedStockQty - quantity) })
                .eq("code", productCode)

              if (updateProductError) {
                console.error("[UpdateStatusDialog] 更新庫存失敗:", updateProductError)
                throw new Error(updateProductError.message)
              }
            }
          }
        }

        onOpenChange(false)
        router.refresh()
      } catch (error) {
        console.error("[UpdateStatusDialog] 流程失敗:", error)
        toastApi.error(error instanceof Error ? error.message : "更新狀態失敗")
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確認更新狀態</AlertDialogTitle>
          <AlertDialogDescription>
            您確定要將單號「{order.order_no || "-"}」的狀態更新為「{statusLabels[newStatus]}」嗎？
            {newStatus === "completed" && (
              <span className="block mt-2 font-bold text-blue-600">
                ⚠️ 注意：完成後將自動{type === "purchase" ? "增加" : "扣減"}商品庫存。
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleUpdate} 
            disabled={isPending}
            className={newStatus === "completed" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
          >
            {isPending ? "處理中..." : "確認更新"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}