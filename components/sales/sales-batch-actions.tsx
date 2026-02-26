"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

type SalesCsvRow = {
  order_no: string
  item_code: string
  quantity: number
  unit_price: number
  sales_date: string
  customer_code: string
}

type ParsedSalesRow = SalesCsvRow & {
  row_no: number
  subtotal: number
}

type SalesOrderRow = {
  id: string
  order_no: string
  order_date: string | null
  customer_cno: string | null
  is_paid: boolean | null
}

const CSV_COLUMNS: Array<keyof SalesCsvRow> = [
  "order_no",
  "item_code",
  "quantity",
  "unit_price",
  "sales_date",
  "customer_code",
]

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value)
  if (normalized.includes('"') || normalized.includes(",") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let currentValue = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const currentChar = line[index]
    const nextChar = line[index + 1]

    if (currentChar === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (currentChar === "," && !inQuotes) {
      values.push(currentValue)
      currentValue = ""
      continue
    }

    currentValue += currentChar
  }

  values.push(currentValue)
  return values
}

function sanitizeCsvHeader(header: string) {
  return String(header || "")
    .replace(/^\uFEFF/g, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060]/g, "")
    .trim()
}

function toNumberOrZero(value: string) {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function normalizeDateInput(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const normalized = raw.replace(/[.]/g, "-").replace(/[\/]/g, "-")
  const parts = normalized
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 3) return raw

  const [year, month, day] = parts
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return raw
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function formatSupabaseError(error: any, fallbackMessage: string) {
  const message = String(error?.message || fallbackMessage)
  const details = String(error?.details || "").trim()
  return details ? `${message}（${details}）` : message
}

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === "x" ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

async function querySalesOrders(supabase: ReturnType<typeof createClient>) {
  const attempts = [
    "id,order_no,order_date,customer_cno,is_paid",
    "id,order_number,order_date,customer_cno,is_paid",
  ]

  for (const selectText of attempts) {
    const result = await supabase.from("sales_orders").select(selectText)
    if (!result.error) {
      const rows = (result.data || []).map((row: any) => ({
        id: String(row.id ?? ""),
        order_no: String(row.order_no ?? row.order_number ?? "").trim(),
        order_date: row.order_date ?? null,
        customer_cno: row.customer_cno ?? null,
        is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
      }))
      return rows as SalesOrderRow[]
    }
  }

  throw new Error("讀取銷貨單失敗")
}

async function queryProductsCodes(supabase: ReturnType<typeof createClient>) {
  const attempts = ["code", "pno"]
  for (const selectText of attempts) {
    const result = await supabase.from("products").select(selectText)
    if (!result.error) {
      const codes = (result.data || [])
        .map((row: any) => String(row.code ?? row.pno ?? "").trim())
        .filter(Boolean)
      return new Set(codes)
    }
  }
  throw new Error("讀取商品資料失敗")
}

async function queryCustomerCodes(supabase: ReturnType<typeof createClient>) {
  const attempts = ["code", "cno", "code,cno"]
  for (const selectText of attempts) {
    const result = await supabase.from("customers").select(selectText)
    if (!result.error) {
      const codes = (result.data || [])
        .map((row: any) => String(row.code ?? row.cno ?? "").trim())
        .filter(Boolean)
      return new Set(codes)
    }
  }

  throw new Error("讀取客戶資料失敗")
}

async function createSalesOrderByOrderNo(
  supabase: ReturnType<typeof createClient>,
  orderNo: string,
  orderDate: string,
  customerCode: string | null,
) {
  const normalizedOrderNo = String(orderNo || "").trim()
  if (!normalizedOrderNo) {
    throw new Error("建立銷貨單失敗：order_no 不可為空")
  }

  const payloadBase = {
    order_date: orderDate || null,
    customer_cno: customerCode,
    total_amount: 0,
    status: "completed",
    is_paid: false,
  }

  const attempts = [{ ...payloadBase, order_no: normalizedOrderNo }, { ...payloadBase, order_number: normalizedOrderNo }]

  let lastError: any = null

  for (const payload of attempts) {
    const { error } = await supabase.from("sales_orders").insert(payload)
    if (!error) {
      return
    }
    if (String(error?.code || "") === "23505") {
      return
    }
    lastError = error
  }

  throw new Error(formatSupabaseError(lastError, `建立銷貨單 ${normalizedOrderNo} 失敗`))
}

async function queryExistingItemIdsByOrderAndCode(
  supabase: ReturnType<typeof createClient>,
  ordersById: Map<string, SalesOrderRow>,
) {
  const attempts = [
    "id,sales_order_id,code",
    "id,sales_order_id,product_code",
    "id,sales_order_id,product_pno",
  ]

  let rows: any[] = []
  let loaded = false

  for (const selectText of attempts) {
    const result = await supabase.from("sales_order_items").select(selectText)
    if (!result.error) {
      rows = (result.data || []) as any[]
      loaded = true
      break
    }
  }

  if (!loaded) {
    throw new Error("讀取銷貨明細失敗")
  }

  const keyToId = new Map<string, string>()
  for (const row of rows) {
    const orderNo = String(ordersById.get(String(row.sales_order_id ?? ""))?.order_no ?? "").trim()
    const itemCode = String(row.code ?? row.product_code ?? row.product_pno ?? "").trim()
    const id = String(row.id ?? "").trim()
    if (!orderNo || !itemCode || !id) continue
    keyToId.set(`${orderNo}::${itemCode}`, id)
  }

  return keyToId
}

async function upsertSalesItems(
  supabase: ReturnType<typeof createClient>,
  rows: Array<{ id: string; sales_order_id: string; code: string; quantity: number; unit_price: number; subtotal: number }>,
) {
  const attempts = [
    {
      buildPayload: (row: (typeof rows)[number]) => ({
        id: row.id,
        sales_order_id: row.sales_order_id,
        code: row.code,
        quantity: row.quantity,
        unit_price: row.unit_price,
        subtotal: row.subtotal,
      }),
    },
    {
      buildPayload: (row: (typeof rows)[number]) => ({
        id: row.id,
        sales_order_id: row.sales_order_id,
        product_code: row.code,
        quantity: row.quantity,
        unit_price: row.unit_price,
        subtotal: row.subtotal,
      }),
    },
    {
      buildPayload: (row: (typeof rows)[number]) => ({
        id: row.id,
        sales_order_id: row.sales_order_id,
        product_pno: row.code,
        quantity: row.quantity,
        unit_price: row.unit_price,
        subtotal: row.subtotal,
      }),
    },
  ]

  let lastError: any = null

  for (const attempt of attempts) {
    const payload = rows.map((row) => attempt.buildPayload(row))
    const { error } = await supabase.from("sales_order_items").upsert(payload, { onConflict: "id", on_conflict: "id" } as any)
    if (!error) return
    lastError = error
  }

  throw new Error(formatSupabaseError(lastError, "匯入銷貨明細失敗"))
}

async function recalculateProductStocksFromTransactions(supabase: ReturnType<typeof createClient>) {
  const purchaseItemAttempts = ["code,quantity", "product_pno,quantity"]
  const salesItemAttempts = ["code,quantity", "product_code,quantity", "product_pno,quantity"]

  let purchaseTotals = new Map<string, number>()
  let salesTotals = new Map<string, number>()
  let purchasesLoaded = false
  let salesLoaded = false

  for (const selectText of purchaseItemAttempts) {
    const result = await supabase.from("purchase_order_items").select(selectText)
    if (result.error) continue

    const totals = new Map<string, number>()
    for (const row of (result.data || []) as any[]) {
      const code = String(row.code ?? row.product_pno ?? "").trim()
      if (!code) continue
      const quantity = Number(row.quantity ?? 0)
      totals.set(code, (totals.get(code) || 0) + (Number.isFinite(quantity) ? quantity : 0))
    }

    purchaseTotals = totals
    purchasesLoaded = true
    break
  }

  for (const selectText of salesItemAttempts) {
    const result = await supabase.from("sales_order_items").select(selectText)
    if (result.error) continue

    const totals = new Map<string, number>()
    for (const row of (result.data || []) as any[]) {
      const code = String(row.code ?? row.product_code ?? row.product_pno ?? "").trim()
      if (!code) continue
      const quantity = Number(row.quantity ?? 0)
      totals.set(code, (totals.get(code) || 0) + (Number.isFinite(quantity) ? quantity : 0))
    }

    salesTotals = totals
    salesLoaded = true
    break
  }

  if (!purchasesLoaded || !salesLoaded) {
    throw new Error("重算庫存失敗：無法讀取進銷貨明細")
  }

  const productAttempts = [
    "code,stock_qty",
    "pno,stock_quantity",
    "code,stock_qty,purchase_qty_total",
    "pno,stock_quantity,purchase_qty_total",
  ]

  for (const selectText of productAttempts) {
    const productsResult = await supabase.from("products").select(selectText)
    if (productsResult.error) continue

    const productRows = (productsResult.data || []) as any[]
    for (const productRow of productRows) {
      const itemCode = String(productRow.code ?? productRow.pno ?? "").trim()
      if (!itemCode) continue

      const purchaseQty = Number(purchaseTotals.get(itemCode) || 0)
      const salesQty = Number(salesTotals.get(itemCode) || 0)
      const nextStockQty = Math.max(0, purchaseQty - salesQty)

      const payload = productRow.code !== undefined ? { stock_qty: nextStockQty } : { stock_quantity: nextStockQty }
      const eqColumn = productRow.code !== undefined ? "code" : "pno"

      const { error: updateError } = await supabase.from("products").update(payload).eq(eqColumn, itemCode)
      if (updateError) {
        throw new Error(updateError.message || `商品 ${itemCode} 庫存重算失敗`)
      }
    }

    return
  }

  throw new Error("重算庫存失敗：無法讀取商品資料")
}

async function syncAccountsReceivable(supabase: ReturnType<typeof createClient>) {
  const orders = await querySalesOrders(supabase)

  const { data: existingRows, error: existingError } = await supabase
    .from("accounts_receivable")
    .select("id,sales_order_id")

  if (existingError) {
    throw new Error(formatSupabaseError(existingError, "同步應收帳款失敗"))
  }

  const arBySalesOrderId = new Map<string, string>()
  for (const row of (existingRows || []) as any[]) {
    const salesOrderId = String(row.sales_order_id ?? "").trim()
    const arId = String(row.id ?? "").trim()
    if (!salesOrderId || !arId) continue
    arBySalesOrderId.set(salesOrderId, arId)
  }

  for (const order of orders) {
    if (!order.id) continue

    const orderTotal = await supabase
      .from("sales_order_items")
      .select("subtotal")
      .eq("sales_order_id", order.id)

    if (orderTotal.error) {
      throw new Error(formatSupabaseError(orderTotal.error, `計算銷貨單 ${order.order_no} 金額失敗`))
    }

    const totalAmount = ((orderTotal.data || []) as any[]).reduce((sum, row) => sum + Number(row.subtotal ?? 0), 0)
    const paid = Boolean(order.is_paid)

    const payload = {
      customer_cno: order.customer_cno,
      amount_due: totalAmount,
      total_amount: totalAmount,
      paid_amount: paid ? totalAmount : 0,
      due_date: normalizeDateInput(String(order.order_date || "")) || null,
      status: paid ? "paid" : "unpaid",
    }

    const existingId = arBySalesOrderId.get(order.id)
    if (existingId) {
      const { error: updateError } = await supabase.from("accounts_receivable").update(payload).eq("id", existingId)
      if (updateError) {
        throw new Error(formatSupabaseError(updateError, `更新銷貨單 ${order.order_no} 應收帳款失敗`))
      }
    } else {
      const { error: insertError } = await supabase.from("accounts_receivable").insert({ sales_order_id: order.id, ...payload })
      if (insertError) {
        throw new Error(formatSupabaseError(insertError, `建立銷貨單 ${order.order_no} 應收帳款失敗`))
      }
    }
  }
}

export function SalesBatchActions() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [syncDeleteMissing, setSyncDeleteMissing] = useState(false)

  const toastApi = {
    success: (message: string) =>
      toast({
        title: "成功",
        description: message,
      }),
    error: (message: string) =>
      toast({
        title: "錯誤",
        description: message,
        variant: "destructive",
      }),
  }

  const handleExportCsv = async () => {
    try {
      setIsExporting(true)
      const supabase = createClient()
      const orders = await querySalesOrders(supabase)
      const orderById = new Map(orders.map((order) => [order.id, order]))

      const itemAttempts = [
        "sales_order_id,code,quantity,unit_price",
        "sales_order_id,product_code,quantity,unit_price",
        "sales_order_id,product_pno,quantity,unit_price",
      ]

      let itemRows: any[] = []
      let itemsLoaded = false

      for (const selectText of itemAttempts) {
        const result = await supabase.from("sales_order_items").select(selectText)
        if (!result.error) {
          itemRows = (result.data || []) as any[]
          itemsLoaded = true
          break
        }
      }

      if (!itemsLoaded) {
        throw new Error("讀取銷貨明細失敗")
      }

      const exportRows: SalesCsvRow[] = itemRows.map((item) => {
        const order = orderById.get(String(item.sales_order_id ?? ""))
        return {
          order_no: String(order?.order_no ?? "").trim(),
          item_code: String(item.code ?? item.product_code ?? item.product_pno ?? "").trim(),
          quantity: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          sales_date: String(order?.order_date ?? ""),
          customer_code: String(order?.customer_cno ?? ""),
        }
      })

      const header = CSV_COLUMNS.join(",")
      const rows = exportRows.map((row) => CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...rows].join("\n")}`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `sales_items_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出銷貨明細 CSV 失敗")
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    const isConfirmed = window.confirm("這將根據單號與商品編號覆蓋現有資料，確定執行嗎？")
    if (!isConfirmed) return

    try {
      setIsImporting(true)

      const rawText = await file.text()
      const text = rawText.replace(/^\uFEFF/, "")
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      if (lines.length < 2) {
        throw new Error("CSV 內容不足，至少需要標題列與一筆資料")
      }

      const headers = parseCsvLine(lines[0]).map((header) => sanitizeCsvHeader(header))
      for (const requiredColumn of CSV_COLUMNS) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位：${requiredColumn}`)
        }
      }

      const parsedRows: ParsedSalesRow[] = []
      lines.slice(1).forEach((line, index) => {
        const values = parseCsvLine(line)
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
          accumulator[header] = values[columnIndex] ?? ""
          return accumulator
        }, {})

        const orderNo = String(valueByColumn.order_no ?? "").trim()
        const itemCode = String(valueByColumn.item_code ?? "").trim()
        const salesDate = String(valueByColumn.sales_date ?? "").trim()
        const customerCode = String(valueByColumn.customer_code ?? "").trim()
        const quantityText = String(valueByColumn.quantity ?? "").trim()
        const unitPriceText = String(valueByColumn.unit_price ?? "").trim()

        const isCompletelyEmpty = !orderNo && !itemCode && !salesDate && !customerCode && !quantityText && !unitPriceText
        if (isCompletelyEmpty) return

        if (!orderNo) {
          throw new Error(`第 ${index + 2} 列缺少 order_no，請填入你要的新單號`)
        }

        const quantity = toNumberOrZero(quantityText)
        const unitPrice = toNumberOrZero(unitPriceText)

        parsedRows.push({
          row_no: index + 2,
          order_no: orderNo,
          item_code: itemCode,
          quantity,
          unit_price: unitPrice,
          sales_date: salesDate,
          customer_code: customerCode,
          subtotal: quantity * unitPrice,
        })
      })

      if (parsedRows.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 item_code 欄位")
      }

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的銷貨明細（order_no + item_code）。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const supabase = createClient()
      const [initialOrders, productCodes, customerCodes] = await Promise.all([
        querySalesOrders(supabase),
        queryProductsCodes(supabase),
        queryCustomerCodes(supabase),
      ])

      const orderByNo = new Map(initialOrders.map((order) => [order.order_no, order]))
      const missingOrderNos = new Set<string>()

      for (const row of parsedRows) {
        if (!row.item_code || !productCodes.has(row.item_code)) {
          throw new Error(`第 ${row.row_no} 列失敗：item_code ${row.item_code || "(空白)"} 不存在`)
        }

        if (row.customer_code && !customerCodes.has(row.customer_code)) {
          throw new Error(`第 ${row.row_no} 列失敗：customer_code ${row.customer_code} 不存在`)
        }

        if (!orderByNo.has(row.order_no)) {
          missingOrderNos.add(row.order_no)
        }
      }

      for (const missingOrderNo of missingOrderNos) {
        const sampleRow = parsedRows.find((row) => row.order_no === missingOrderNo)
        if (!sampleRow) continue

        await createSalesOrderByOrderNo(
          supabase,
          missingOrderNo,
          normalizeDateInput(sampleRow.sales_date),
          String(sampleRow.customer_code || "").trim() || null,
        )
      }

      const orders = await querySalesOrders(supabase)
      const latestOrderByNo = new Map(orders.map((order) => [order.order_no, order]))
      const orderById = new Map(orders.map((order) => [order.id, order]))
      const headerUpdates = new Map<string, { order_date: string; customer_cno: string | null; total_amount: number }>()

      for (const row of parsedRows) {
        const order = latestOrderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const current = headerUpdates.get(row.order_no)
        const mergedOrderDate =
          normalizeDateInput(row.sales_date) || current?.order_date || normalizeDateInput(String(order.order_date || "")) || ""
        const mergedCustomerCode =
          String(row.customer_code || "").trim() || current?.customer_cno || (String(order.customer_cno || "").trim() || null)
        const mergedTotal = Number(current?.total_amount || 0) + Number(row.subtotal)

        headerUpdates.set(row.order_no, {
          order_date: mergedOrderDate,
          customer_cno: mergedCustomerCode,
          total_amount: mergedTotal,
        })
      }

      for (const [orderNo, header] of headerUpdates.entries()) {
        const basePayload = {
          order_date: header.order_date || null,
          customer_cno: header.customer_cno,
          total_amount: Number(header.total_amount || 0),
        }

        const { error: updateError } = await supabase.from("sales_orders").update(basePayload).eq("order_no", orderNo)

        if (!updateError) continue

        const { error: fallbackError } = await supabase.from("sales_orders").update(basePayload).eq("order_number", orderNo)

        if (fallbackError) {
          throw new Error(`order_no ${orderNo} 單頭更新失敗：${formatSupabaseError(fallbackError, updateError.message)}`)
        }
      }

      const existingItemIdByKey = await queryExistingItemIdsByOrderAndCode(supabase, orderById)

      const upsertPayloadByKey = new Map<
        string,
        {
          id: string
          sales_order_id: string
          code: string
          quantity: number
          unit_price: number
          subtotal: number
        }
      >()

      for (const row of parsedRows) {
        const order = latestOrderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const existingId = existingItemIdByKey.get(`${row.order_no}::${row.item_code}`)
        const payload = {
          id: existingId || createUuid(),
          sales_order_id: order.id,
          code: row.item_code,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          subtotal: Number(row.subtotal),
        }

        const dedupeKey = existingId ? `id:${existingId}` : `new:${order.id}::${row.item_code}`
        upsertPayloadByKey.set(dedupeKey, payload)
      }

      const upsertPayload = Array.from(upsertPayloadByKey.values())
      await upsertSalesItems(supabase, upsertPayload)

      if (syncDeleteMissing) {
        const csvItemKeys = new Set(parsedRows.map((row) => `${row.order_no}::${row.item_code}`))
        const existingRows = await queryExistingItemIdsByOrderAndCode(supabase, orderById)
        const idsToDelete: string[] = []

        for (const [itemKey, itemId] of existingRows.entries()) {
          if (!csvItemKeys.has(itemKey)) {
            idsToDelete.push(itemId)
          }
        }

        if (idsToDelete.length > 0) {
          const { error: deleteError } = await supabase.from("sales_order_items").delete().in("id", idsToDelete)
          if (deleteError) {
            throw new Error(formatSupabaseError(deleteError, "刪除缺少銷貨明細失敗"))
          }
        }
      }

      await recalculateProductStocksFromTransactions(supabase)
      await syncAccountsReceivable(supabase)

      toastApi.success("銷貨資料批次更新完成")
      router.refresh()
    } catch (error: any) {
      toastApi.error(error?.message || "匯入失敗")
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      <Button variant="outline" onClick={handleExportCsv} disabled={isExporting || isImporting}>
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? "匯出中..." : "匯出銷貨明細 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
      <div className="flex items-center gap-2 pl-1">
        <Checkbox
          id="sync-delete-missing-sales"
          checked={syncDeleteMissing}
          onCheckedChange={(checked) => setSyncDeleteMissing(Boolean(checked))}
          disabled={isExporting || isImporting}
        />
        <Label htmlFor="sync-delete-missing-sales" className="text-sm cursor-pointer">
          同步刪除缺少單號+商品編號
        </Label>
      </div>
    </div>
  )
}
