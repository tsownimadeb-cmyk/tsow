import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { addToSyncQueue } from "@/lib/local-db"
import { removeProductSnapshot, upsertProductSnapshot } from "@/lib/desktop-offline-mutations"

export async function POST(request: NextRequest) {
  const body = await request.json()
  const payload = body?.payload || body

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("products").insert(payload).select("*").single()
    if (error) throw error

    upsertProductSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    addToSyncQueue("create", "products", payload, payload?.code)
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

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("products").update(payload).eq("code", code).select("*").single()
    if (error) throw error

    upsertProductSnapshot(data || payload)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    addToSyncQueue("update", "products", { code, payload }, code)
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

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("products").delete().eq("code", code)
    if (error) throw error

    removeProductSnapshot(code)
    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    addToSyncQueue("delete", "products", { code }, code)
    removeProductSnapshot(code)
    return NextResponse.json({ success: true, offline: true, message: error?.message || "queued" })
  }
}
