import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

type OrderBy = {
  column: string
  ascending: boolean
}

type QueryResult = {
  table: string
  rows: Record<string, unknown>[]
  expectedCount: number | null
  actualCount: number
  pageCount: number
  complete: boolean
  warning: string | null
}

type TableExportConfig = {
  table: string
  orderBy: OrderBy[]
}

const isMissingRelationError = (message: string) =>
  /relation\s+"[^"]+"\s+does not exist/i.test(message) ||
  /could not find the table/i.test(message)

const EXPORT_PAGE_SIZE = 1000

const TABLE_EXPORTS: TableExportConfig[] = [
  { table: "suppliers", orderBy: [{ column: "sort_order", ascending: true }, { column: "name", ascending: true }, { column: "id", ascending: true }] },
  { table: "customers", orderBy: [{ column: "code", ascending: true }] },
  { table: "products", orderBy: [{ column: "code", ascending: true }] },
  { table: "purchase_orders", orderBy: [{ column: "order_date", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "purchase_order_items", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "sales_orders", orderBy: [{ column: "order_date", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "sales_order_items", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "accounts_receivable", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "accounts_payable", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "purchase_returns", orderBy: [{ column: "return_date", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "purchase_return_items", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "sales_returns", orderBy: [{ column: "return_date", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "sales_return_items", orderBy: [{ column: "created_at", ascending: false }, { column: "id", ascending: false }] },
  { table: "ar_receipts", orderBy: [{ column: "payment_date", ascending: false }, { column: "created_at", ascending: false }, { column: "id", ascending: false }] },
]

async function queryTable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  config: TableExportConfig,
): Promise<QueryResult> {
  const rows: Record<string, unknown>[] = []
  let from = 0
  let expectedCount: number | null = null
  let pageCount = 0

  while (true) {
    let query = supabase
      .from(config.table)
      .select("*", { count: "exact" })
      .range(from, from + EXPORT_PAGE_SIZE - 1)

    for (const order of config.orderBy) {
      query = query.order(order.column, { ascending: order.ascending })
    }

    const result = await query

    if (result.error) {
      if (isMissingRelationError(result.error.message || "")) {
        return {
          table: config.table,
          rows: [],
          expectedCount: 0,
          actualCount: 0,
          pageCount,
          complete: true,
          warning: `${config.table} 不存在，已略過`,
        }
      }

      throw new Error(result.error.message || `查詢 ${config.table} 失敗`)
    }

    if (expectedCount === null && typeof result.count === "number") {
      expectedCount = result.count
    }

    const pageRows = (result.data || []) as Record<string, unknown>[]
    pageCount += 1
    rows.push(...pageRows)

    if (expectedCount !== null && rows.length >= expectedCount) {
      break
    }

    if (pageRows.length < EXPORT_PAGE_SIZE) {
      break
    }

    from += EXPORT_PAGE_SIZE
  }

  const complete = expectedCount === null || rows.length === expectedCount
  const warning = complete
    ? null
    : `${config.table} 匯出筆數異常：資料庫計數 ${expectedCount} 筆，實際匯出 ${rows.length} 筆`

  return {
    table: config.table,
    rows,
    expectedCount,
    actualCount: rows.length,
    pageCount,
    complete,
    warning,
  }
}

const toCellText = (value: unknown) => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const escapeCsvCell = (value: string) => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const toCsv = (rows: Record<string, unknown>[], columns: string[]) => {
  const header = columns.join(",")
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(toCellText(row[column]))).join(",")).join("\r\n")
  return `\uFEFF${header}\r\n${body}`
}

const collectColumns = (rows: Record<string, unknown>[]) => {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      keys.add(key)
    }
  }
  return Array.from(keys)
}

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
    }

    const supabase = await createClient()

    const tableQueries = await Promise.all(TABLE_EXPORTS.map((config) => queryTable(supabase, config)))

    const warnings = tableQueries
      .map((result) => result.warning)
      .filter((warning): warning is string => Boolean(warning))

    const zip = new JSZip()
    for (const result of tableQueries) {
      const columns = collectColumns(result.rows)
      if (columns.length === 0) {
        zip.file(`${result.table}.csv`, "")
      } else {
        zip.file(`${result.table}.csv`, toCsv(result.rows, columns))
      }
    }

    const metadata = {
      exported_at: new Date().toISOString(),
      summary: Object.fromEntries(tableQueries.map((result) => [result.table, result.actualCount])),
      expected_summary: Object.fromEntries(tableQueries.map((result) => [result.table, result.expectedCount])),
      export_status: Object.fromEntries(tableQueries.map((result) => [
        result.table,
        {
          expected: result.expectedCount,
          exported: result.actualCount,
          pages: result.pageCount,
          complete: result.complete,
        },
      ])),
      complete: warnings.length === 0,
      warnings,
    }
    zip.file("README.json", JSON.stringify(metadata, null, 2))

    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = `business-backup-${timestamp}.zip`

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=\"${fileName}\"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "匯出失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
