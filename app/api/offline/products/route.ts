import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { removeProductSnapshot, upsertProductSnapshot } from "@/lib/desktop-offline-mutations"
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
    upsertProductSnapshot(payload)
    return NextResponse.json({ success: true, offline: true, localOnly: true })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from("products").insert(payload).select("*").single()
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
    const { error } = await supabase.from("products").update(payload).eq("code", code).select("*").single()
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

    return NextResponse.json({ success: true, offline: false })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端刪除失敗，操作已保留在瀏覽器等待重試。" },
      { status: 502 },
    )
  }
}
