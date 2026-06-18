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
    const { data, error } = await supabase.from("customers").select("*").order("code", { ascending: true })

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: data || [],
      updatedAt: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "failed to load customers cache" },
      { status: 500 }
    )
  }
}
