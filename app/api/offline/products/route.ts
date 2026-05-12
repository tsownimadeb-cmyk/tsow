import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { addToSyncQueue } from "@/lib/local-db"
import { removeProductSnapshot, upsertProductSnapshot } from "@/lib/desktop-offline-mutations"
import { isLocalOnlyMode } from "@/lib/runtime-mode-server"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const payload = body?.payload || body

  if (await isLocalOnlyMode()) {
    upsertProductSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("products").insert(payload).select("*").single()
    if (error) throw error

    upsertProductSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("create", "products", payload, payload?.code)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上儲存失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    upsertProductSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const code = String(body?.code || body?.payload?.code || "").trim()
  const payload = body?.payload || body

  if (!code) {
    return NextResponse.json({ success: false, message: "缺少商品代號" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    upsertProductSnapshot({ code, ...payload })
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("products").update(payload).eq("code", code).select("*").single()
    if (error) throw error

    upsertProductSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("update", "products", { code, payload }, code)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上儲存失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    upsertProductSnapshot({ code, ...payload })
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = String(searchParams.get("code") || "").trim()
  if (!code) {
    return NextResponse.json({ success: false, message: "缺少商品代號" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    removeProductSnapshot(code)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("products").delete().eq("code", code)
    if (error) throw error

    removeProductSnapshot(code)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("delete", "products", { code }, code)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上刪除失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    removeProductSnapshot(code)
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}
