import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/site-auth'

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const ok = await verifyAuthToken(cookieValue)
    if (!ok) {
      return NextResponse.json({ success: false, message: '未授權' }, { status: 401 })
    }

    const supabase = await createClient()

    const sortedResult = await supabase
      .from("suppliers")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })

    if (!sortedResult.error) {
      return NextResponse.json({
        success: true,
        data: sortedResult.data || [],
        updatedAt: Date.now(),
      })
    }

    const fallbackResult = await supabase.from("suppliers").select("*").order("created_at", { ascending: false })

    if (fallbackResult.error) throw fallbackResult.error

    return NextResponse.json({
      success: true,
      data: fallbackResult.data || [],
      updatedAt: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "failed to load suppliers cache" },
      { status: 500 }
    )
  }
}
