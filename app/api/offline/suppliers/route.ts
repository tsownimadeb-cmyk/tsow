import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { removeSupplierSnapshot, upsertSupplierSnapshot } from "@/lib/desktop-offline-mutations"
import { isLocalOnlyMode } from "@/lib/runtime-mode-server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export async function POST(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  const body = await request.json()
  const payload = body?.payload || body

  if (await isLocalOnlyMode()) {
    upsertSupplierSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("suppliers").insert(payload).select("*").single()
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
    const { error } = await supabase.from("suppliers").update(payload).eq("id", id).select("*").single()
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

    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端刪除失敗，操作已保留在瀏覽器等待重試。" },
      { status: 502 },
    )
  }
}
