"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Download, Upload } from "lucide-react"

type ProductCsvRow = {
  code: string
  name: string
  spec: string | null
  unit: string | null
  category: string | null
  cost: number
  price: number
  sale_price: number | null
}

const CSV_COLUMNS: Array<keyof ProductCsvRow> = ["code", "name", "spec", "unit", "category", "cost", "price", "sale_price"]

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
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === "," && !inQuotes) {
      values.push(currentValue)
      currentValue = ""
      continue
    }

    currentValue += char
  }

  values.push(currentValue)
  return values
}

function toNumberOrZero(value: string) {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function toNullableNumber(value: string) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function ProductsBatchActions() {
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
      const { data, error } = await supabase
        .from("products")
        .select("code,name,spec,unit,category,cost,price,sale_price")
        .order("code", { ascending: true })

      if (error) throw error

      const products = (data || []) as ProductCsvRow[]
      const header = CSV_COLUMNS.join(",")
      const rows = products.map((product) =>
        CSV_COLUMNS.map((column) => escapeCsvValue(product[column])).join(","),
      )
      const csvBody = [header, ...rows].join("\n")
      const csvWithBom = `\uFEFF${csvBody}`

      const blob = new Blob([csvWithBom], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      const timestamp = new Date().toISOString().slice(0, 10)

      link.href = url
      link.download = `products_${timestamp}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出 CSV 失敗")
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

    const isConfirmed = window.confirm("這將會根據商品編號 (code) 覆蓋現有資料，確定執行嗎？")
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

      const headers = parseCsvLine(lines[0]).map((header) => header.replace(/^\uFEFF/, "").trim())
      const requiredColumns = ["code", "name", "spec", "unit", "category", "cost", "price", "sale_price"]

      for (const requiredColumn of requiredColumns) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位: ${requiredColumn}`)
        }
      }

      const rows: ProductCsvRow[] = lines.slice(1).map((line) => {
        const values = parseCsvLine(line)
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, index) => {
          accumulator[header] = values[index] ?? ""
          return accumulator
        }, {})

        return {
          code: (valueByColumn.code || "").trim(),
          name: (valueByColumn.name || "").trim(),
          spec: valueByColumn.spec?.trim() ? valueByColumn.spec.trim() : null,
          unit: valueByColumn.unit?.trim() ? valueByColumn.unit.trim() : null,
          category: valueByColumn.category?.trim() ? valueByColumn.category.trim() : null,
          cost: toNumberOrZero(valueByColumn.cost || ""),
          price: toNumberOrZero(valueByColumn.price || ""),
          sale_price: toNullableNumber(valueByColumn.sale_price || ""),
        }
      })

      const upsertPayload = rows.filter((row) => row.code)
      const csvCodes = Array.from(new Set(upsertPayload.map((row) => row.code)))

      if (upsertPayload.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 code 欄位")
      }

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的商品。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const supabase = createClient()
      const { error } = await supabase
        .from("products")
        .upsert(upsertPayload, { onConflict: "code", on_conflict: "code" } as any)

      if (error) throw error

      if (syncDeleteMissing) {
        const { data: existingRows, error: existingError } = await supabase
          .from("products")
          .select("code")

        if (existingError) throw existingError

        const codesToDelete = (existingRows || [])
          .map((row: { code?: string | null }) => String(row.code || "").trim())
          .filter((code) => code && !csvCodes.includes(code))

        if (codesToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from("products")
            .delete()
            .in("code", codesToDelete)

          if (deleteError) throw deleteError
        }
      }

      toastApi.success("批次更新完成")
      window.location.reload()
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
        {isExporting ? "匯出中..." : "匯出 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
      <div className="flex items-center gap-2 pl-1">
        <Checkbox
          id="sync-delete-missing-products"
          checked={syncDeleteMissing}
          onCheckedChange={(checked) => setSyncDeleteMissing(Boolean(checked))}
          disabled={isExporting || isImporting}
        />
        <Label htmlFor="sync-delete-missing-products" className="text-sm cursor-pointer">
          同步刪除缺少 code
        </Label>
      </div>
    </div>
  )
}