import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { removeCustomerSnapshot, upsertCustomerSnapshot } from "@/lib/desktop-offline-mutations"
import { isLocalOnlyMode } from "@/lib/runtime-mode-server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

const CUSTOMER_REFERENCE_TABLES = [
  { table: "sales_orders", columns: ["customer_cno"] },
  { table: "accounts_receivable", columns: ["customer_cno"] },
  { table: "sales_returns", columns: ["customer_cno", "customer_code"] },
  { table: "ar_receipts", columns: ["customer_cno"] },
] as const

function isMissingRenameRpcError(message: string) {
  return /Could not find the function|does not exist|schema cache/i.test(message)
}

function isSkippableReferenceSyncError(message: string) {
  return /column .* does not exist|relation .* does not exist|Could not find the .* column .* in the schema cache|Could not find the table .* in the schema cache/i.test(
    message
  )
}

async function buildCustomerPayload(supabase: any, input: Record<string, any>) {
  const sampleResult = await supabase.from("customers").select("*").limit(1)
  if (sampleResult.error) {
    throw new Error(sampleResult.error.message || "讀取 customers 欄位失敗")
  }

  const existingColumns = new Set<string>(Object.keys((sampleResult.data || [])[0] || {}))
  const hasColumn = (column: string) => existingColumns.has(column)

  const keyColumn = "code"
  const legacyCodeColumn = hasColumn("cno") ? "cno" : null
  const nameColumn = "name"
  const tel1Column = hasColumn("tel1") ? "tel1" : null
  const tel2Column = hasColumn("tel2") ? "tel2" : hasColumn("tel11") ? "tel11" : null
  const tel3Column = hasColumn("fax") ? "fax" : hasColumn("tel3") ? "tel3" : hasColumn("tel12") ? "tel12" : null
  const addressColumn = hasColumn("addr") ? "addr" : hasColumn("address") ? "address" : null

  const nextCode = String(input.code || "").trim().toUpperCase()
  const payload: Record<string, any> = {
    [nameColumn]: input.name ?? null,
  }

  if (tel1Column) payload[tel1Column] = input.tel1 ?? null
  if (tel2Column) payload[tel2Column] = input.tel2 ?? null
  if (tel3Column) payload[tel3Column] = input.tel3 ?? null
  if (addressColumn) payload[addressColumn] = input.address ?? input.addr ?? null

  return {
    payload,
    nextCode,
    keyColumn,
    legacyCodeColumn,
  }
}

export async function POST(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  const body = await request.json()
  const payload = body?.payload || body

  if (await isLocalOnlyMode()) {
    upsertCustomerSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const mapped = await buildCustomerPayload(supabase, payload)
    const insertPayload: Record<string, any> = {
      [mapped.keyColumn]: mapped.nextCode,
      ...mapped.payload,
    }
    if (mapped.legacyCodeColumn) {
      insertPayload[mapped.legacyCodeColumn] = mapped.nextCode
    }

    const { error } = await supabase.from("customers").insert(insertPayload).select("*").single()
    if (error) throw error

    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端儲存失敗，操作已保留在瀏覽器等待重試。" },
      { status: 502 },
    )
  }
}

export async function PUT(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  const body = await request.json()
  const code = String(body?.targetCode || body?.code || body?.payload?.code || "").trim().toUpperCase()
  const payload = body?.payload || body

  if (!code) {
    return NextResponse.json({ success: false, message: "缺少客戶編號" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    upsertCustomerSnapshot({ code: payload?.code || code, ...payload })
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const mapped = await buildCustomerPayload(supabase, payload)
    const nextCode = mapped.nextCode || code

    if (code && nextCode && code !== nextCode) {
      const rpcResult = await supabase.rpc("rename_customer_code", {
        p_old_code: code,
        p_new_code: nextCode,
      })

      if (rpcResult.error && !isMissingRenameRpcError(rpcResult.error.message || "")) {
        throw new Error(rpcResult.error.message || "同步客戶編號失敗")
      }

      if (rpcResult.error) {
        const keyUpdatePayload: Record<string, string> = {
          [mapped.keyColumn]: nextCode,
        }
        if (mapped.legacyCodeColumn) {
          keyUpdatePayload[mapped.legacyCodeColumn] = nextCode
        }

        const renameCustomerResult = await supabase
          .from("customers")
          .update(keyUpdatePayload)
          .eq(mapped.keyColumn, code)

        if (renameCustomerResult.error) {
          throw new Error(renameCustomerResult.error.message || "更新客戶編號失敗")
        }

        for (const ref of CUSTOMER_REFERENCE_TABLES) {
          for (const column of ref.columns) {
            const refResult = await supabase.from(ref.table).update({ [column]: nextCode } as never).eq(column, code)
            const refMessage = refResult.error?.message || ""
            if (!refResult.error) break
            if (isSkippableReferenceSyncError(refMessage)) continue
            throw new Error(`同步 ${ref.table} 失敗：${refMessage}`)
          }
        }
      }
    }

    const { error } = await supabase
      .from("customers")
      .update(mapped.payload)
      .eq(mapped.keyColumn, nextCode)
      .select("*")
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端儲存失敗，操作已保留在瀏覽器等待重試。" },
      { status: 502 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const code = String(searchParams.get("code") || "").trim()
  if (!code) {
    return NextResponse.json({ success: false, message: "缺少客戶編號" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    removeCustomerSnapshot(code)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("customers").delete().eq("code", code)
    if (error) throw error

    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端刪除失敗，操作已保留在瀏覽器等待重試。" },
      { status: 502 },
    )
  }
}
