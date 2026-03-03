"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { recalculateProductCostsByCodes } from "@/lib/product-cost-recalculation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

type PurchaseCsvRow = {
  order_no: string
  item_code: string
  quantity: number
  unit_price: number
  purchase_date: string
  vendor_code: string
}

type PurchaseExportCsvRow = PurchaseCsvRow & {
  shipping_fee: number
  is_paid: string
}

type ParsedPurchaseRow = PurchaseCsvRow & {
  row_no: number
  subtotal: number
  is_paid_input: boolean | null
  shipping_fee_input: number | null
}

type OrderRow = {
  id: string
  order_no: string
  order_date: string | null
  supplier_id: string | null
  shipping_fee: number
  is_paid: boolean | null
  total_amount: number
}

const CSV_COLUMNS: Array<keyof PurchaseCsvRow> = [
  "order_no",
  "item_code",
  "quantity",
  "unit_price",
  "purchase_date",
  "vendor_code",
]

const EXPORT_CSV_COLUMNS: Array<keyof PurchaseExportCsvRow> = [...CSV_COLUMNS, "shipping_fee", "is_paid"]

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

function toOptionalNumber(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

function parseBooleanInput(value: string) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return null
  if (["true", "1", "yes", "y"].includes(normalized)) return true
  if (["false", "0", "no", "n"].includes(normalized)) return false
  return null
}

function isShippingFeeColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("shipping_fee") && (message.includes("column") || message.includes("schema cache"))
}

function normalizeDateInput(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const normalized = raw.replace(/[.]/g, "-").replace(/[\/]/g, "-")
  const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean)
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

async function queryOrders(supabase: ReturnType<typeof createClient>) {
  const result = await supabase.from("purchase_orders").select("id,order_no,order_date,supplier_id,shipping_fee,is_paid,total_amount")
  if (result.error) throw new Error("讀取進貨單失敗")

  const rows = (result.data || []).map((row: any) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? "").trim(),
    order_date: row.order_date ?? null,
    supplier_id: row.supplier_id ?? null,
    shipping_fee: Number(row.shipping_fee ?? 0),
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    total_amount: Number(row.total_amount ?? 0),
  }))
  return rows as OrderRow[]
}

async function recalculatePurchaseOrderTotals(supabase: ReturnType<typeof createClient>, targetOrderIds: string[]) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return
  }

  const { data: itemRows, error: itemError } = await supabase
    .from("purchase_order_items")
    .select("purchase_order_id,subtotal")
    .in("purchase_order_id", normalizedOrderIds)

  if (itemError) {
    throw new Error(formatSupabaseError(itemError, "重算進貨單總額失敗"))
  }

  const totalByOrderId = new Map<string, number>()
  for (const row of (itemRows || []) as any[]) {
    const orderId = String(row.purchase_order_id ?? "").trim()
    if (!orderId) continue
    const subtotal = Number(row.subtotal ?? 0)
    totalByOrderId.set(orderId, Number(totalByOrderId.get(orderId) || 0) + (Number.isFinite(subtotal) ? subtotal : 0))
  }

  for (const orderId of normalizedOrderIds) {
    const nextTotalAmount = Number(totalByOrderId.get(orderId) || 0)
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({ total_amount: nextTotalAmount })
      .eq("id", orderId)

    if (updateError) {
      throw new Error(formatSupabaseError(updateError, `更新進貨單 ${orderId} 總額失敗`))
    }
  }
}

async function syncAccountsPayable(supabase: ReturnType<typeof createClient>, targetOrderIds: string[]) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return
  }

  const allOrders = await queryOrders(supabase)
  const targetOrderIdSet = new Set(normalizedOrderIds)
  const orders = allOrders.filter((order) => targetOrderIdSet.has(String(order.id || "").trim()))

  const { data: existingRows, error: existingError } = await supabase
    .from("accounts_payable")
    .select("id,purchase_order_id")
    .in("purchase_order_id", normalizedOrderIds)

  if (existingError) {
    throw new Error(formatSupabaseError(existingError, "同步應付帳款失敗"))
  }

  const apByPurchaseOrderId = new Map<string, string>()
  for (const row of (existingRows || []) as any[]) {
    const purchaseOrderId = String(row.purchase_order_id ?? "").trim()
    const apId = String(row.id ?? "").trim()
    if (!purchaseOrderId || !apId) continue
    apByPurchaseOrderId.set(purchaseOrderId, apId)
  }

  for (const order of orders) {
    if (!order.id) continue

    const totalAmount = Number(order.total_amount || 0)
    const paid = Boolean(order.is_paid)

    const payload = {
      supplier_id: order.supplier_id,
      amount_due: totalAmount,
      total_amount: totalAmount,
      paid_amount: paid ? totalAmount : 0,
      due_date: normalizeDateInput(String(order.order_date || "")) || null,
      status: paid ? "paid" : "unpaid",
    }

    const existingId = apByPurchaseOrderId.get(order.id)
    if (existingId) {
      const { error: updateError } = await supabase.from("accounts_payable").update(payload).eq("id", existingId)
      if (updateError) {
        throw new Error(formatSupabaseError(updateError, `更新進貨單 ${order.order_no} 應付帳款失敗`))
      }
    } else {
      const { error: insertError } = await supabase.from("accounts_payable").insert({ purchase_order_id: order.id, ...payload })
      if (insertError) {
        throw new Error(formatSupabaseError(insertError, `建立進貨單 ${order.order_no} 應付帳款失敗`))
      }
    }
  }
}

async function queryProductsCodes(supabase: ReturnType<typeof createClient>) {
  const result = await supabase.from("products").select("code")
  if (result.error) throw new Error("讀取商品資料失敗")
  const codes = (result.data || [])
    .map((row: any) => String(row.code ?? "").trim())
    .filter(Boolean)
  return new Set(codes)
}

async function querySupplierIds(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from("suppliers").select("id")
  if (error) throw new Error(error.message || "讀取供應商資料失敗")
  return new Set((data || []).map((row: any) => String(row.id ?? "").trim()).filter(Boolean))
}

async function createPurchaseOrderByOrderNo(
  supabase: ReturnType<typeof createClient>,
  orderNo: string,
  orderDate: string,
  supplierId: string | null,
) {
  const normalizedOrderNo = String(orderNo || "").trim()
  if (!normalizedOrderNo) {
    throw new Error("建立進貨單失敗：order_no 不可為空")
  }

  const payloadBase = {
    order_date: orderDate || null,
    supplier_id: supplierId,
    total_amount: 0,
    status: "pending",
    is_paid: false,
  }

  const { error } = await supabase.from("purchase_orders").insert({ ...payloadBase, order_no: normalizedOrderNo })
  if (!error) return
  if (String(error?.code || "") === "23505") return
  throw new Error(formatSupabaseError(error, `建立進貨單 ${normalizedOrderNo} 失敗`))
}

async function queryExistingItemIdsByOrderAndCode(
  supabase: ReturnType<typeof createClient>,
  ordersById: Map<string, OrderRow>,
  targetOrderIds?: string[],
) {
  let query = supabase.from("purchase_order_items").select("id,purchase_order_id,order_no,code")

  if (targetOrderIds && targetOrderIds.length > 0) {
    query = query.in("purchase_order_id", targetOrderIds)
  }

  const result = await query
  if (result.error) {
    throw new Error(formatSupabaseError(result.error, "讀取進貨明細失敗"))
  }

  const data = (result.data || []) as any[]

  const keyToId = new Map<string, string>()
  for (const row of data) {
    const orderNo = String(row.order_no ?? ordersById.get(String(row.purchase_order_id ?? ""))?.order_no ?? "").trim()
    const itemCode = String(row.code ?? "").trim()
    const id = String(row.id ?? "").trim()
    if (!orderNo || !itemCode || !id) continue
    keyToId.set(`${orderNo}::${itemCode}`, id)
  }

  return keyToId
}

async function recalculateAllStockViaRpc(supabase: ReturnType<typeof createClient>) {
  const { error } = await supabase.rpc("recalculate_all_stock")
  if (error) {
    throw new Error(formatSupabaseError(error, "重算庫存失敗：RPC recalculate_all_stock 執行失敗"))
  }
}

export function PurchasesBatchActions() {
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
      const orders = await queryOrders(supabase)
      const orderById = new Map(orders.map((order) => [order.id, order]))

      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("purchase_order_id,code,quantity,unit_price")

      if (error) throw error

      const exportRows: PurchaseExportCsvRow[] = ((data || []) as any[]).map((item) => {
        const order = orderById.get(String(item.purchase_order_id ?? ""))
        return {
          order_no: String(order?.order_no ?? "").trim(),
          item_code: String(item.code ?? "").trim(),
          quantity: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          purchase_date: String(order?.order_date ?? ""),
          vendor_code: String(order?.supplier_id ?? ""),
          shipping_fee: Number(order?.shipping_fee ?? 0),
          is_paid: order?.is_paid === true ? "true" : "false",
        }
      })

      const header = EXPORT_CSV_COLUMNS.join(",")
      const rows = exportRows.map((row) => EXPORT_CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...rows].join("\n")}`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `purchase_items_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出進貨明細 CSV 失敗")
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
      const requiredColumns = [...CSV_COLUMNS]
      for (const requiredColumn of requiredColumns) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位：${requiredColumn}`)
        }
      }

      const parsedRows: ParsedPurchaseRow[] = []
      lines.slice(1).forEach((line, index) => {
        const values = parseCsvLine(line)
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
          accumulator[header] = values[columnIndex] ?? ""
          return accumulator
        }, {})

        const orderNo = String(valueByColumn.order_no ?? "").trim()

        const itemCode = String(valueByColumn.item_code ?? "").trim()
        const purchaseDate = String(valueByColumn.purchase_date ?? "").trim()
        const vendorCode = String(valueByColumn.vendor_code ?? "").trim()
        const quantityText = String(valueByColumn.quantity ?? "").trim()
        const unitPriceText = String(valueByColumn.unit_price ?? "").trim()
        const shippingFeeText = String(valueByColumn.shipping_fee ?? "").trim()
        const isPaidText = String(valueByColumn.is_paid ?? "").trim()

        const isCompletelyEmpty = !orderNo && !itemCode && !purchaseDate && !vendorCode && !quantityText && !unitPriceText
        if (isCompletelyEmpty) return

        if (!orderNo) {
          throw new Error(`第 ${index + 2} 列缺少 order_no，請填入你要的新單號`)
        }

        const quantity = toNumberOrZero(quantityText)
        const unitPrice = toNumberOrZero(unitPriceText)
        const shippingFeeInput = toOptionalNumber(shippingFeeText)
        const isPaidInput = parseBooleanInput(isPaidText)

        parsedRows.push({
          row_no: index + 2,
          order_no: orderNo,
          item_code: itemCode,
          quantity,
          unit_price: unitPrice,
          purchase_date: purchaseDate,
          vendor_code: vendorCode,
          subtotal: quantity * unitPrice,
          is_paid_input: isPaidInput,
          shipping_fee_input: shippingFeeInput,
        })
      })

      if (parsedRows.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 item_code 欄位")
      }

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的進貨明細（order_no + item_code）。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const supabase = createClient()
      const [initialOrders, productCodes, supplierIds] = await Promise.all([
        queryOrders(supabase),
        queryProductsCodes(supabase),
        querySupplierIds(supabase),
      ])

      const orderByNo = new Map(initialOrders.map((order) => [order.order_no, order]))
      const missingOrderNos = new Set<string>()

      for (const row of parsedRows) {
        if (!row.item_code || !productCodes.has(row.item_code)) {
          throw new Error(`第 ${row.row_no} 列失敗：item_code ${row.item_code || "(空白)"} 不存在`)
        }

        if (row.vendor_code && !supplierIds.has(row.vendor_code)) {
          throw new Error(`第 ${row.row_no} 列失敗：vendor_code ${row.vendor_code} 不存在`)
        }

        if (!orderByNo.has(row.order_no)) {
          missingOrderNos.add(row.order_no)
        }
      }

      for (const missingOrderNo of missingOrderNos) {
        const sampleRow = parsedRows.find((row) => row.order_no === missingOrderNo)
        if (!sampleRow) continue

        await createPurchaseOrderByOrderNo(
          supabase,
          missingOrderNo,
          normalizeDateInput(sampleRow.purchase_date),
          String(sampleRow.vendor_code || "").trim() || null,
        )
      }

      const orders = await queryOrders(supabase)
      const latestOrderByNo = new Map(orders.map((order) => [order.order_no, order]))
      const orderById = new Map(orders.map((order) => [order.id, order]))
      const targetOrderIds = Array.from(
        new Set(
          parsedRows
            .map((row) => String(latestOrderByNo.get(row.order_no)?.id || "").trim())
            .filter(Boolean),
        ),
      )
      const affectedProductCodes = new Set(
        parsedRows
          .map((row) => String(row.item_code || "").trim().toUpperCase())
          .filter(Boolean),
      )
      const headerUpdates = new Map<string, { order_date: string; supplier_id: string | null; is_paid: boolean; shipping_fee: number }>()

      for (const row of parsedRows) {
        const order = latestOrderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const current = headerUpdates.get(row.order_no)
        const mergedOrderDate =
          normalizeDateInput(row.purchase_date) ||
          current?.order_date ||
          normalizeDateInput(String(order.order_date || "")) ||
          ""
        const mergedSupplierId =
          String(row.vendor_code || "").trim() ||
          current?.supplier_id ||
          (String(order.supplier_id || "").trim() || null)
        const mergedIsPaid =
          row.is_paid_input === null || row.is_paid_input === undefined
            ? (current?.is_paid ?? Boolean(order.is_paid))
            : row.is_paid_input
        const mergedShippingFee =
          row.shipping_fee_input === null || row.shipping_fee_input === undefined
            ? (current?.shipping_fee ?? Number(order.shipping_fee || 0))
            : Number(row.shipping_fee_input)

        headerUpdates.set(row.order_no, {
          order_date: mergedOrderDate,
          supplier_id: mergedSupplierId,
          is_paid: mergedIsPaid,
          shipping_fee: Number(mergedShippingFee || 0),
        })
      }

      for (const [orderNo, header] of headerUpdates.entries()) {
        const { error: updateError } = await supabase
          .from("purchase_orders")
          .update({
            order_date: header.order_date || null,
            supplier_id: header.supplier_id,
            is_paid: header.is_paid,
            shipping_fee: header.shipping_fee,
          })
          .eq("order_no", orderNo)

        if (!updateError) continue

        if (isShippingFeeColumnMissing(updateError)) {
          const retryWithoutShipping = await supabase
            .from("purchase_orders")
            .update({
              order_date: header.order_date || null,
              supplier_id: header.supplier_id,
              is_paid: header.is_paid,
            })
            .eq("order_no", orderNo)
          if (!retryWithoutShipping.error) continue
        }

        throw new Error(`order_no ${orderNo} 單頭更新失敗：${formatSupabaseError(updateError, updateError.message)}`)
      }

      const targetOrderNos = Array.from(new Set(parsedRows.map((row) => row.order_no).filter(Boolean)))

      if (targetOrderIds.length > 0) {
        const deleteByOrderId = await supabase
          .from("purchase_order_items")
          .delete()
          .in("purchase_order_id", targetOrderIds)

        if (deleteByOrderId.error) {
          const deleteByOrderNo = await supabase
            .from("purchase_order_items")
            .delete()
            .in("order_no", targetOrderNos)

          if (deleteByOrderNo.error) {
            throw new Error(formatSupabaseError(deleteByOrderNo.error, deleteByOrderId.error.message || "清除既有進貨明細失敗"))
          }
        }
      }

      const insertPayloadByKey = new Map<string, {
        purchase_order_id: string
        code: string
        quantity: number
        unit_price: number
        subtotal: number
      }>()

      for (const row of parsedRows) {
        const order = latestOrderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const payload = {
          purchase_order_id: order.id,
          code: row.item_code,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          subtotal: Number(row.subtotal),
        }

        const dedupeKey = `${order.id}::${row.item_code}`

        insertPayloadByKey.set(dedupeKey, payload)
      }

      const insertPayload = Array.from(insertPayloadByKey.values())

      const { error: insertError } = await supabase
        .from("purchase_order_items")
        .insert(insertPayload)

      if (insertError) {
        throw new Error(formatSupabaseError(insertError, "匯入進貨明細失敗"))
      }

      const affectedOrderIds = new Set<string>(targetOrderIds)

      if (syncDeleteMissing) {
        const csvItemKeys = new Set(parsedRows.map((row) => `${row.order_no}::${row.item_code}`))
        const csvOrderNos = new Set(parsedRows.map((row) => String(row.order_no || "").trim()).filter(Boolean))
        const existingRows = await queryExistingItemIdsByOrderAndCode(supabase, orderById)
        const idsToDelete: string[] = []

        for (const [itemKey, itemId] of existingRows.entries()) {
          if (!csvItemKeys.has(itemKey)) {
            idsToDelete.push(itemId)
            const deletedOrderNo = String(itemKey.split("::")[0] || "").trim()
            const deletedCode = String(itemKey.split("::")[1] || "").trim().toUpperCase()
            if (deletedCode) {
              affectedProductCodes.add(deletedCode)
            }
            const deletedOrder = latestOrderByNo.get(deletedOrderNo)
            if (deletedOrder?.id) {
              affectedOrderIds.add(String(deletedOrder.id))
            }
          }
        }

        const orderIdsToDelete: string[] = []
        const orderNosToDelete: string[] = []
        for (const order of orders) {
          const existingOrderNo = String(order.order_no || "").trim()
          if (!existingOrderNo) continue
          if (csvOrderNos.has(existingOrderNo)) continue
          if (order.id) orderIdsToDelete.push(String(order.id))
          orderNosToDelete.push(existingOrderNo)
        }

        if (idsToDelete.length > 0) {
          const { error: deleteError } = await supabase.from("purchase_order_items").delete().in("id", idsToDelete)
          if (deleteError) {
            throw new Error(formatSupabaseError(deleteError, "刪除缺少進貨明細失敗"))
          }
        }

        if (orderIdsToDelete.length > 0) {
          const { error: deleteItemsByOrderIdError } = await supabase
            .from("purchase_order_items")
            .delete()
            .in("purchase_order_id", orderIdsToDelete)
          if (deleteItemsByOrderIdError) {
            throw new Error(formatSupabaseError(deleteItemsByOrderIdError, "刪除缺少進貨單明細失敗"))
          }

          const { error: deleteApError } = await supabase
            .from("accounts_payable")
            .delete()
            .in("purchase_order_id", orderIdsToDelete)
          if (deleteApError) {
            throw new Error(formatSupabaseError(deleteApError, "刪除缺少應付帳款失敗"))
          }

          const { error: deleteOrdersError } = await supabase
            .from("purchase_orders")
            .delete()
            .in("id", orderIdsToDelete)
          if (deleteOrdersError) {
            throw new Error(formatSupabaseError(deleteOrdersError, "刪除缺少進貨單失敗"))
          }
        }

        if (orderNosToDelete.length > 0) {
          await supabase.from("purchase_order_items").delete().in("order_no", orderNosToDelete)
          await supabase.from("purchase_orders").delete().in("order_no", orderNosToDelete)
        }
      }

      const orderIdsToRecalculate = Array.from(affectedOrderIds)

      await recalculatePurchaseOrderTotals(supabase, orderIdsToRecalculate)
      await syncAccountsPayable(supabase, orderIdsToRecalculate)

      await recalculateAllStockViaRpc(supabase)
      await recalculateProductCostsByCodes(supabase, Array.from(affectedProductCodes))

      toastApi.success("進貨資料批次更新完成")
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
        {isExporting ? "匯出中..." : "匯出進貨明細 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
      <div className="flex items-center gap-2 pl-1">
        <Checkbox
          id="sync-delete-missing-purchases"
          checked={syncDeleteMissing}
          onCheckedChange={(checked) => setSyncDeleteMissing(Boolean(checked))}
          disabled={isExporting || isImporting}
        />
        <Label htmlFor="sync-delete-missing-purchases" className="text-sm cursor-pointer">
          同步刪除缺少單號+商品編號
        </Label>
      </div>
    </div>
  )
}
