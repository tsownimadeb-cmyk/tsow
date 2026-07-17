import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { upsertProductSnapshot } from "@/lib/desktop-offline-mutations"
import { isLocalOnlyMode } from "@/lib/runtime-mode-server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"
import { parseProductBulkPriceRequest } from "@/lib/product-bulk-prices"

export async function PUT(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!(await verifyAuthToken(cookieValue))) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  const parsed = parseProductBulkPriceRequest(await request.json().catch(() => null))
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 })
  }

  if (await isLocalOnlyMode()) {
    for (const code of parsed.codes) {
      upsertProductSnapshot({ code, ...parsed.prices })
    }
    return NextResponse.json({
      success: true,
      offline: true,
      localOnly: true,
      updatedCount: parsed.codes.length,
    })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("products")
      .update(parsed.prices)
      .in("code", parsed.codes)
      .select("code")

    if (error) throw error

    return NextResponse.json({
      success: true,
      offline: false,
      updatedCount: data?.length || 0,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "雲端批量更新失敗，商品價格未變更。" },
      { status: 502 },
    )
  }
}
