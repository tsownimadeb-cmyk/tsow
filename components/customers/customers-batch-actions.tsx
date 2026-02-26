"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

type CustomerCsvRow = {
  code: string
  name: string
  tel1: string
  tel2: string
  tel3: string
  address: string
  notes: string
}

const CSV_COLUMNS: Array<keyof CustomerCsvRow> = ["code", "name", "tel1", "tel2", "tel3", "address", "notes"]

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

function pickFirstValue(valueByColumn: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = valueByColumn[alias]
    if (value !== undefined) return String(value)
  }
  return ""
}

function generateAutoCustomerCode(rowNo: number) {
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `AUTO${dateTag}${String(rowNo).padStart(4, "0")}`
}

async function queryCustomersForExport(supabase: ReturnType<typeof createClient>) {
  const result = await supabase.from("customers").select("*")
  if (result.error) {
    throw new Error(result.error.message || "讀取客戶資料失敗")
  }

  const rows = ((result.data || []) as any[]).slice()
  rows.sort((left, right) => {
    const leftKey = String(left.code ?? left.cno ?? left.name ?? left.compy ?? "")
    const rightKey = String(right.code ?? right.cno ?? right.name ?? right.compy ?? "")
    return leftKey.localeCompare(rightKey, "zh-Hant")
  })

  return rows
}

async function upsertCustomers(supabase: ReturnType<typeof createClient>, rows: CustomerCsvRow[]) {
  const sampleResult = await supabase.from("customers").select("*").limit(1)
  if (sampleResult.error) {
    throw new Error(sampleResult.error.message || "讀取 customers 欄位失敗")
  }

  const existingColumns = new Set<string>(Object.keys((sampleResult.data || [])[0] || {}))

  const hasColumn = (column: string) => existingColumns.has(column)

  const keyColumn = hasColumn("code") ? "code" : hasColumn("cno") ? "cno" : "code"
  const nameColumn = hasColumn("name") ? "name" : hasColumn("compy") ? "compy" : "name"

  const tel1Column = hasColumn("tel1") ? "tel1" : null
  const tel2Column = hasColumn("tel2") ? "tel2" : hasColumn("tel11") ? "tel11" : null
  const tel3Column = hasColumn("tel3") ? "tel3" : hasColumn("fax") ? "fax" : hasColumn("tel12") ? "tel12" : null
  const addressColumn = hasColumn("address") ? "address" : hasColumn("addr") ? "addr" : null
  const notesColumn = hasColumn("notes") ? "notes" : null

  for (const row of rows) {
    const payload: Record<string, any> = {
      [nameColumn]: row.name,
    }

    if (tel1Column) payload[tel1Column] = row.tel1 || null
    if (tel2Column) payload[tel2Column] = row.tel2 || null
    if (tel3Column) payload[tel3Column] = row.tel3 || null
    if (addressColumn) payload[addressColumn] = row.address || null
    if (notesColumn) payload[notesColumn] = row.notes || null

    const insertPayload: Record<string, any> = {
      [keyColumn]: row.code,
      ...payload,
    }

    const updateResult = await supabase
      .from("customers")
      .update(payload)
      .eq(keyColumn, row.code)
      .select(keyColumn)

    if (updateResult.error) {
      throw new Error(updateResult.error.message || `客戶 ${row.code} 更新失敗`)
    }

    if ((updateResult.data || []).length > 0) {
      continue
    }

    const insertResult = await supabase.from("customers").insert(insertPayload)
    if (insertResult.error) {
      throw new Error(insertResult.error.message || `客戶 ${row.code} 新增失敗`)
    }
  }
}

async function queryCustomerKeyColumnAndValues(supabase: ReturnType<typeof createClient>) {
  const sampleResult = await supabase.from("customers").select("*").limit(1)
  if (sampleResult.error) {
    throw new Error(sampleResult.error.message || "讀取 customers 欄位失敗")
  }

  const existingColumns = new Set<string>(Object.keys((sampleResult.data || [])[0] || {}))
  const keyColumn = existingColumns.has("code") ? "code" : existingColumns.has("cno") ? "cno" : "code"

  const listResult = await supabase.from("customers").select(keyColumn)
  if (listResult.error) {
    throw new Error(listResult.error.message || "讀取客戶代碼失敗")
  }

  const values = (listResult.data || [])
    .map((row: any) => String(row[keyColumn] || "").trim())
    .filter(Boolean)

  return { keyColumn, values }
}

export function CustomersBatchActions() {
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
      const data = await queryCustomersForExport(supabase)

      const rows: CustomerCsvRow[] = data.map((row: any) => ({
        code: String(row.code ?? row.cno ?? "").trim(),
        name: String(row.name ?? row.compy ?? "姓名不詳").trim() || "姓名不詳",
        tel1: String(row.tel1 ?? "").trim(),
        tel2: String(row.tel2 ?? row.tel11 ?? "").trim(),
        tel3: String(row.fax ?? row.tel3 ?? row.tel12 ?? "").trim(),
        address: String(row.addr ?? row.address ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
      }))

      const header = CSV_COLUMNS.join(",")
      const csvRows = rows.map((row) => CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...csvRows].join("\n")}`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出客戶 CSV 失敗")
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

    const isConfirmed = window.confirm("這將根據 code（舊版資料庫為 cno）覆蓋現有客戶資料，確定執行嗎？")
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

      const rows: CustomerCsvRow[] = lines
        .slice(1)
        .map((line, index) => {
          const values = parseCsvLine(line)
          const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
            accumulator[header] = values[columnIndex] ?? ""
            return accumulator
          }, {})

          const rawCode = pickFirstValue(valueByColumn, ["code", "cno"])
          const rawName = pickFirstValue(valueByColumn, ["name", "compy"])
          const rawTel1 = pickFirstValue(valueByColumn, ["tel1"])
          const rawTel2 = pickFirstValue(valueByColumn, ["tel2", "tel11"])
          const rawTel3 = pickFirstValue(valueByColumn, ["tel3", "fax", "tel12"])
          const rawAddress = pickFirstValue(valueByColumn, ["address", "addr"])
          const rawNotes = pickFirstValue(valueByColumn, ["notes"])

          const hasAnyValue = [rawCode, rawName, rawTel1, rawTel2, rawTel3, rawAddress, rawNotes]
            .some((value) => String(value || "").trim().length > 0)
          if (!hasAnyValue) {
            return null
          }

          const code = String(rawCode || "").trim() || generateAutoCustomerCode(index + 2)
          const name = String(rawName || "").trim() || "姓名不詳"

          return {
            code,
            name,
            tel1: String(rawTel1 || "").trim(),
            tel2: String(rawTel2 || "").trim(),
            tel3: String(rawTel3 || "").trim(),
            address: String(rawAddress || "").trim(),
            notes: String(rawNotes || "").trim(),
          }
        })
        .filter((row): row is CustomerCsvRow => Boolean(row))

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的客戶（code/cno）。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const usedCodes = new Set<string>()
      for (const row of rows) {
        let nextCode = String(row.code || "").trim()
        let suffix = 1
        while (usedCodes.has(nextCode)) {
          nextCode = `${row.code}-${suffix}`
          suffix += 1
        }
        row.code = nextCode
        usedCodes.add(nextCode)
      }

      if (!rows.length) {
        throw new Error("沒有可匯入的客戶資料")
      }

      const supabase = createClient()
      await upsertCustomers(supabase, rows)

      if (syncDeleteMissing) {
        const csvCodes = new Set(rows.map((row) => String(row.code || "").trim()).filter(Boolean))
        const { keyColumn, values } = await queryCustomerKeyColumnAndValues(supabase)
        const codesToDelete = values.filter((value) => !csvCodes.has(value))

        if (codesToDelete.length > 0) {
          const { error: deleteError } = await supabase.from("customers").delete().in(keyColumn, codesToDelete)
          if (deleteError) {
            throw new Error(deleteError.message || "刪除缺少客戶資料失敗")
          }
        }
      }

      toastApi.success("客戶資料批次更新完成")
      router.refresh()
    } catch (error: any) {
      toastApi.error(error?.message || "匯入客戶資料失敗")
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      <Button variant="outline" onClick={handleExportCsv} disabled={isExporting || isImporting}>
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? "匯出中..." : "匯出客戶 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
      <div className="flex items-center gap-2 pl-1">
        <Checkbox
          id="sync-delete-missing-customers"
          checked={syncDeleteMissing}
          onCheckedChange={(checked) => setSyncDeleteMissing(Boolean(checked))}
          disabled={isExporting || isImporting}
        />
        <Label htmlFor="sync-delete-missing-customers" className="text-sm cursor-pointer">
          同步刪除缺少 code
        </Label>
      </div>
    </div>
  )
}
