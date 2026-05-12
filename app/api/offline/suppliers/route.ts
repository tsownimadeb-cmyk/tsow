import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { addToSyncQueue } from "@/lib/local-db"
import { removeSupplierSnapshot, upsertSupplierSnapshot } from "@/lib/desktop-offline-mutations"
import { isLocalOnlyMode } from "@/lib/runtime-mode-server"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const payload = body?.payload || body

  if (await isLocalOnlyMode()) {
    upsertSupplierSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("suppliers").insert(payload).select("*").single()
    if (error) throw error

    upsertSupplierSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("create", "suppliers", payload, payload?.id)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上儲存失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    upsertSupplierSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json()
  const id = String(body?.id || body?.payload?.id || "").trim()
  const payload = body?.payload || body

  if (!id) {
    return NextResponse.json({ success: false, message: "缺少供應商 ID" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    upsertSupplierSnapshot({ id, ...payload })
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("suppliers").update(payload).eq("id", id).select("*").single()
    if (error) throw error

    upsertSupplierSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("update", "suppliers", { id, payload }, id)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上儲存失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    upsertSupplierSnapshot({ id, ...payload })
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = String(searchParams.get("id") || "").trim()
  if (!id) {
    return NextResponse.json({ success: false, message: "缺少供應商 ID" }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    removeSupplierSnapshot(id)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("suppliers").delete().eq("id", id)
    if (error) throw error

    removeSupplierSnapshot(id)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    const queueId = addToSyncQueue("delete", "suppliers", { id }, id)
    if (!queueId) {
      return NextResponse.json(
        { success: false, message: error?.message || "線上刪除失敗，且本機離線儲存不可用" },
        { status: 502 }
      )
    }

    removeSupplierSnapshot(id)
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}
