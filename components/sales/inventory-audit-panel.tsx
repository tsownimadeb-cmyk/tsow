"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"

type InventoryAuditProduct = {
  code: string
  name: string
  stock_qty: number
  price: number | null
  sale_price: number | null
}

type InventoryAuditPanelProps = {
  products: InventoryAuditProduct[]
}

const formatCurrency = (value: number) => {
  return Number.isFinite(value) ? `${value.toFixed(2)}` : "0.00"
}

const parseCountValue = (value: string, defaultQty: number) => {
  const normalized = String(value || "").trim()
  if (normalized === "") return defaultQty
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return NaN
  }
  return parsed
}

export default function InventoryAuditPanel({ products }: InventoryAuditPanelProps) {
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(products.map((product) => [product.code, String(product.stock_qty ?? 0)])),
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      products.map((product) => {
        const rawValue = counts[product.code] ?? String(product.stock_qty ?? 0)
        const countedQty = parseCountValue(rawValue, product.stock_qty ?? 0)
        const salesQty = Number.isFinite(countedQty)
          ? Number(product.stock_qty ?? 0) - countedQty
          : NaN
        const unitPrice = Number(product.sale_price ?? product.price ?? 0)
        return {
          ...product,
          rawCount: rawValue,
          countedQty,
          salesQty,
          unitPrice,
          subtotal: salesQty > 0 ? salesQty * unitPrice : 0,
        }
      }),
    [counts, products],
  )

  const gainRows = rows.filter((row) => Number.isFinite(row.countedQty) && row.countedQty > row.stock_qty)
  const invalidRows = rows.filter((row) => !Number.isFinite(row.countedQty) || row.countedQty < 0)
  const positiveItems = rows.filter((row) => Number.isFinite(row.salesQty) && row.salesQty > 0)
  const totalSaleQuantity = positiveItems.reduce((sum, row) => sum + row.salesQty, 0)
  const totalAmount = positiveItems.reduce((sum, row) => sum + row.subtotal, 0)

  const handleChange = (code: string, value: string) => {
    setCounts((prev) => ({ ...prev, [code]: value }))
  }

  const handleSubmit = async () => {
    if (invalidRows.length > 0) {
      toast({
        title: "輸入錯誤",
        description: "請確認現場庫存為 0 或正整數。",
        variant: "destructive",
      })
      return
    }

    if (positiveItems.length === 0) {
      toast({
        title: "沒有盤點差異",
        description: "目前沒有銷貨數量 > 0 的商品，無法建立盤點銷貨單。",
        variant: "destructive",
      })
      return
    }

    const rpcItems = positiveItems.map((item) => ({
      code: item.code,
      quantity: item.salesQty,
      counted_qty: item.countedQty,
    }))

    setIsSubmitting(true)
    setSuccessMessage(null)

    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("create_inventory_audit_sales_order", {
        p_customer_cno: "Z001",
        p_delivery_method: "customer_pickup",
        p_status: "completed",
        p_notes: "【盤點補登】",
        p_items: rpcItems,
      })

      if (error) {
        throw error
      }

      setSuccessMessage(
        `已建立盤點銷貨單 ${String(data?.order_no ?? data?.id ?? "")}，已同步更新現場庫存。`,
      )
      toast({ title: "建立成功", description: "盤點銷貨單已建立。" })
    } catch (err: any) {
      toast({
        title: "建立失敗",
        description: String(err?.message || "無法建立盤點銷貨單"),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p>盤點銷貨單只會建立「銷貨數量 &gt; 0」的商品。若現場庫存大於系統庫存，該商品將被略過並顯示盤盈警告。</p>
      </div>

      {gainRows.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">盤盈警告</p>
          <p className="mt-2">以下商品現場庫存大於系統庫存，將不會加入盤點銷貨單：</p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {gainRows.map((row) => (
              <li key={row.code}>
                {row.code} / {row.name}：系統庫存 {row.stock_qty}，現場庫存 {row.countedQty}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {successMessage}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-3 py-2">商品編號</th>
              <th className="px-3 py-2">商品名稱</th>
              <th className="px-3 py-2">系統庫存</th>
              <th className="px-3 py-2">現場庫存</th>
              <th className="px-3 py-2">銷貨數量</th>
              <th className="px-3 py-2">售價</th>
              <th className="px-3 py-2">小計</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {rows.map((row) => {
              const isInvalid = !Number.isFinite(row.countedQty) || row.countedQty < 0
              const isGain = Number.isFinite(row.countedQty) && row.countedQty > row.stock_qty
              return (
                <tr key={row.code} className={isInvalid ? "bg-red-50" : isGain ? "bg-amber-50" : ""}>
                  <td className="px-3 py-2 align-top font-medium text-slate-900">{row.code}</td>
                  <td className="px-3 py-2 align-top text-slate-700">{row.name}</td>
                  <td className="px-3 py-2 align-top text-slate-700">{row.stock_qty}</td>
                  <td className="px-3 py-2 align-top">
                    <Input
                      value={row.rawCount}
                      onChange={(event) => handleChange(row.code, event.target.value)}
                      className="w-24"
                      inputMode="numeric"
                    />
                    {isInvalid ? (
                      <p className="mt-1 text-xs text-red-600">請輸入正整數</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-700">{Number.isFinite(row.salesQty) ? row.salesQty : "-"}</td>
                  <td className="px-3 py-2 align-top text-slate-700">{formatCurrency(row.unitPrice)}</td>
                  <td className="px-3 py-2 align-top text-slate-700">{formatCurrency(row.subtotal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm text-slate-700">
          <div>總銷貨數量：{totalSaleQuantity}</div>
          <div>預估總金額：{formatCurrency(totalAmount)}</div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="secondary" onClick={() => setCounts(Object.fromEntries(products.map((product) => [product.code, String(product.stock_qty ?? 0)])))}>
            重設現場庫存
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "建立中..." : "產生盤點銷貨單"}
          </Button>
        </div>
      </div>
    </div>
  )
}
